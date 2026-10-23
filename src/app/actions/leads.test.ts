/**
 * Integration tests for the lead convert / decline actions.
 *
 * Pins the three behaviors that used to be wrong:
 *
 *   - declineLead is gated by intake.decline and writes an
 *     ActivityLog entry (who declined + reason) — it used to be
 *     an ungated mutation with no audit trail.
 *   - convertLeadToMatter rejects inactive practice areas and
 *     inactive stages, mirroring the direct create path.
 *   - conversion carries the lead's dateOfIncident onto the matter,
 *     auto-computes the SOL date from the area's statute period,
 *     and creates the auto-managed critical SOL Deadline — and does
 *     none of that for areas that don't track SOL.
 *   - conversion rolls intake time forward: every lead-scoped
 *     TimeEntry re-homes onto the new matter (matterId set, leadId
 *     cleared — the exactly-one-of scope invariant holds), hours /
 *     amounts are untouched, and the roll-forward is activity-logged
 *     on the matter.
 *   - conversion rolls intake notes forward the same way (threads
 *     and reactions intact).
 *
 * The permission gate itself is stubbed (its resolution logic is
 * covered elsewhere); we assert the actions *invoke* it with the
 * right key.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// The action resolves the actor's TZ (automation date math);
// current-user-tz is server-only, so stub it (same as other suites).
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// convertLeadToMatter ends in redirect(); surface it as a sentinel
// throw so tests can assert "reached the redirect" = success.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { LEAD_NOT_ATTORNEY } from "@/lib/attorney-messages";
import { convertLeadToMatter, createLead, declineLead } from "@/app/actions/leads";
import { saveRecordsFee } from "@/app/actions/records-requests";
import { renameFolder } from "@/app/actions/document-folders";
import {
  resetDb,
  seedBarAdmission,
  seedFirm,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRequirePermission = vi.mocked(requirePermission);

let userId: string;

/** Area + one stage, with full control over the flags the conversion
 *  path must respect (isActive, SOL tracking, statute period). */
async function seedArea(opts: {
  areaActive?: boolean;
  stageActive?: boolean;
  hasSol?: boolean;
  periodDays?: number | null;
  allowedBillingTypes?: string[];
  defaultBillingType?: string;
}): Promise<{ areaId: string; stageId: string }> {
  const area = await prisma.practiceArea.create({
    data: {
      name: `Area ${Math.random().toString(36).slice(2, 8)}`,
      isActive: opts.areaActive ?? true,
      hasStatuteOfLimitations: opts.hasSol ?? false,
      ...(opts.allowedBillingTypes ? { allowedBillingTypes: opts.allowedBillingTypes } : {}),
      ...(opts.defaultBillingType ? { defaultBillingType: opts.defaultBillingType } : {}),
      // opts.periodDays is a plain day count (ADR-035: DAYS unit).
      statutePeriodAmount: opts.periodDays ?? null,
      statutePeriodUnit: opts.periodDays ? "DAYS" : null,
    },
    select: { id: true },
  });
  const stage = await prisma.matterStage.create({
    data: {
      practiceAreaId: area.id,
      name: "Intake",
      order: 0,
      isActive: opts.stageActive ?? true,
    },
    select: { id: true },
  });
  return { areaId: area.id, stageId: stage.id };
}

async function seedIntakeLead(opts?: {
  dateOfIncident?: Date | null;
  stage?: string;
  conflictCheck?: string;
}): Promise<{ leadId: string }> {
  const lead = await prisma.lead.create({
    data: {
      name: "Priya Patel",
      email: "priya@example.com",
      dateOfIncident: opts?.dateOfIncident ?? null,
      stage: opts?.stage ?? "new",
      ...(opts?.conflictCheck ? { conflictCheck: opts.conflictCheck } : {}),
    },
    select: { id: true },
  });
  return { leadId: lead.id };
}

function convertForm(opts: { areaId: string; stageId: string; leadAttorneyId?: string }): FormData {
  const fd = new FormData();
  fd.set("practiceAreaId", opts.areaId);
  fd.set("stageId", opts.stageId);
  fd.set("name", "Patel v. Doe");
  fd.set("billingType", "contingent");
  fd.set("leadAttorneyId", opts.leadAttorneyId ?? userId);
  return fd;
}

function declineForm(reason = ""): FormData {
  const fd = new FormData();
  fd.set("reason", reason);
  return fd;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "attorney@example.com" });
  userId = u.userId;
  // The converter is an attorney by default, so forms can pick them as lead.
  await seedBarAdmission({ userId });
  mockedGetUser.mockResolvedValue(userId);
  // Gate passes by default; it returns the actor id like the real
  // implementation so declineLead can chain it into the audit log.
  mockedRequirePermission.mockResolvedValue(userId);
});

// ── declineLead ─────────────────────────────────────────────────────────

describe("declineLead", () => {
  test("is gated by intake.decline", async () => {
    const { leadId } = await seedIntakeLead();
    await declineLead(leadId, { status: "idle" }, declineForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("intake.decline");
  });

  test("marks the lead declined and stores the reason", async () => {
    const { leadId } = await seedIntakeLead();
    const res = await declineLead(leadId, { status: "idle" }, declineForm("Statute already ran"));
    expect(res.status).toBe("ok");

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true, declineReason: true },
    });
    expect(lead.stage).toBe("declined");
    expect(lead.declineReason).toBe("Statute already ran");
  });

  test("writes an audit-trail ActivityLog entry with actor + reason", async () => {
    const { leadId } = await seedIntakeLead();
    await declineLead(leadId, { status: "idle" }, declineForm("Conflict of interest"));

    const entry = await prisma.activityLog.findFirst({
      where: { title: { startsWith: "Lead declined" } },
      select: { userId: true, title: true, detail: true, matterId: true },
    });
    expect(entry).not.toBeNull();
    expect(entry!.userId).toBe(userId);
    // The entry identifies WHICH lead (name in the title, id in the
    // detail) — ActivityLog has no lead reference.
    expect(entry!.title).toBe("Lead declined: Priya Patel");
    expect(entry!.detail).toBe(`lead ${leadId}: Conflict of interest`);
    // Declined leads never got a matter — firm-scope entry.
    expect(entry!.matterId).toBeNull();
  });

  test("refuses to decline an already-converted lead", async () => {
    const { leadId } = await seedIntakeLead({ stage: "converted" });
    const res = await declineLead(leadId, { status: "idle" }, declineForm());
    expect(res.status).toBe("error");

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true },
    });
    expect(lead.stage).toBe("converted");
  });
});

// ── convertLeadToMatter ─────────────────────────────────────────────────

describe("convertLeadToMatter — active-target validation", () => {
  test("rejects an inactive practice area", async () => {
    const { areaId, stageId } = await seedArea({ areaActive: false });
    const { leadId } = await seedIntakeLead();

    const res = await convertLeadToMatter(
      leadId,
      { status: "idle" },
      convertForm({ areaId, stageId }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.practiceAreaId).toBeDefined();
    expect(await prisma.matter.count()).toBe(0);
  });

  test("rejects an inactive stage", async () => {
    const { areaId, stageId } = await seedArea({ stageActive: false });
    const { leadId } = await seedIntakeLead();

    const res = await convertLeadToMatter(
      leadId,
      { status: "idle" },
      convertForm({ areaId, stageId }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.stageId).toBeDefined();
    expect(await prisma.matter.count()).toBe(0);
  });
});

describe("convertLeadToMatter — SOL carry-over", () => {
  const incident = new Date("2024-01-15T00:00:00.000Z");

  test("SOL-tracking area: sets incidentDate, auto-computes SOL date, creates the critical SOL deadline", async () => {
    const { areaId, stageId } = await seedArea({
      hasSol: true,
      periodDays: 730,
    });
    const { leadId } = await seedIntakeLead({ dateOfIncident: incident });

    // Success path ends in redirect(`/matters/…`) — sentinel throw.
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({
      select: {
        id: true,
        incidentDate: true,
        statuteOfLimitationsDate: true,
      },
    });
    expect(matter.incidentDate).toEqual(incident);
    // 2024-01-15 + 730 days (365-day-year convention) = 2026-01-14.
    expect(matter.statuteOfLimitationsDate).toEqual(new Date("2026-01-14T00:00:00.000Z"));

    const deadline = await prisma.deadline.findFirstOrThrow({
      where: { matterId: matter.id, sourceType: "statute_of_limitations" },
      select: {
        title: true,
        kind: true,
        status: true,
        dueDate: true,
        ownerId: true,
      },
    });
    expect(deadline.title).toBe("Statute of limitations");
    expect(deadline.kind).toBe("critical");
    expect(deadline.status).toBe("open");
    expect(deadline.dueDate).toEqual(matter.statuteOfLimitationsDate);
    // Converting user owns the deadline (they're the lead attorney).
    expect(deadline.ownerId).toBe(userId);
  });

  test("non-SOL area: incident date stays in the description only, no SOL fields, no deadline", async () => {
    const { areaId, stageId } = await seedArea({
      hasSol: false,
      periodDays: 730, // stale config must be ignored when tracking is off
    });
    const { leadId } = await seedIntakeLead({ dateOfIncident: incident });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);

    const matter = await prisma.matter.findFirstOrThrow({
      select: {
        incidentDate: true,
        statuteOfLimitationsDate: true,
        description: true,
      },
    });
    expect(matter.incidentDate).toBeNull();
    expect(matter.statuteOfLimitationsDate).toBeNull();
    expect(matter.description).toContain("Date of incident: 2024-01-15");
    expect(await prisma.deadline.count()).toBe(0);
  });

  test("SOL area but lead has no incident date: converts cleanly with no deadline", async () => {
    const { areaId, stageId } = await seedArea({
      hasSol: true,
      periodDays: 730,
    });
    const { leadId } = await seedIntakeLead({ dateOfIncident: null });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);

    const matter = await prisma.matter.findFirstOrThrow({
      select: { incidentDate: true, statuteOfLimitationsDate: true },
    });
    expect(matter.incidentDate).toBeNull();
    expect(matter.statuteOfLimitationsDate).toBeNull();
    expect(await prisma.deadline.count()).toBe(0);
  });
});

// ── convertLeadToMatter — intake time roll-forward ──────────────────────

describe("convertLeadToMatter — intake time roll-forward", () => {
  test("re-homes lead time entries onto the new matter and logs a summary", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    // Two intake entries with distinct hours so totals are checkable.
    await seedTimeEntry({ leadId, userId, hours: 0.5, rate: 0, amount: 0 });
    await seedTimeEntry({ leadId, userId, hours: 1.25, rate: 0, amount: 0 });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({
      select: { id: true },
    });
    const entries = await prisma.timeEntry.findMany({
      select: { matterId: true, leadId: true, hours: true },
      orderBy: { hours: "asc" },
    });
    // Both entries moved: matterId set, leadId cleared — the
    // exactly-one-of scope invariant holds for every row.
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.matterId).toBe(matter.id);
      expect(e.leadId).toBeNull();
    }
    // Hours intact — the entry is the same work, just re-scoped.
    expect(entries.map((e) => e.hours)).toEqual([0.5, 1.25]);
    // Nothing remains attached to the lead.
    expect(await prisma.timeEntry.count({ where: { leadId } })).toBe(0);

    // Roll-forward summary lands in the matter's activity log.
    const log = await prisma.activityLog.findFirst({
      where: { matterId: matter.id, type: "time_entry" },
      select: { title: true, userId: true },
    });
    expect(log).not.toBeNull();
    expect(log!.title).toBe("2 intake time entries carried forward");
    expect(log!.userId).toBe(userId);
  });

  test("singular title for a single carried entry", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    await seedTimeEntry({ leadId, userId, hours: 1, rate: 0, amount: 0 });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);

    const log = await prisma.activityLog.findFirst({
      where: { type: "time_entry" },
      select: { title: true },
    });
    expect(log!.title).toBe("1 intake time entry carried forward");
  });

  test("no intake time → no roll-forward log, conversion unaffected", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);

    expect(await prisma.activityLog.count({ where: { type: "time_entry" } })).toBe(0);
  });

  test("doesn't touch other leads' or other matters' entries", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const otherLead = await prisma.lead.create({
      data: { name: "Other Lead" },
      select: { id: true },
    });
    // A matter that already exists, with its own entry.
    const existingMatter = await prisma.matter.create({
      data: {
        name: "Existing Matter",
        practiceAreaId: areaId,
        stageId,
        feeStructure: "hourly",
      },
      select: { id: true },
    });
    await seedTimeEntry({ leadId, userId, hours: 1 });
    await seedTimeEntry({ leadId: otherLead.id, userId, hours: 2 });
    await seedTimeEntry({ matterId: existingMatter.id, userId, hours: 3 });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);

    // The other lead's entry stayed lead-scoped…
    const otherEntry = await prisma.timeEntry.findFirstOrThrow({
      where: { leadId: otherLead.id },
      select: { matterId: true },
    });
    expect(otherEntry.matterId).toBeNull();
    // …and the pre-existing matter's entry stayed put.
    expect(await prisma.timeEntry.count({ where: { matterId: existingMatter.id } })).toBe(1);
  });
});

describe("convertLeadToMatter — intake notes roll-forward", () => {
  test("re-homes lead notes onto the new matter with threads and reactions intact", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const otherLead = await prisma.lead.create({
      data: { name: "Other Lead" },
      select: { id: true },
    });
    const root = await prisma.note.create({
      data: { leadId, authorId: userId, content: "<p>Screening call</p>" },
      select: { id: true },
    });
    await prisma.note.create({
      data: {
        leadId,
        authorId: userId,
        content: "<p>Follow-up</p>",
        parentNoteId: root.id,
      },
    });
    await prisma.noteReaction.create({
      data: { userId, noteId: root.id, emoji: "👍" },
    });
    await prisma.note.create({
      data: { leadId: otherLead.id, authorId: userId, content: "<p>X</p>" },
    });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({ select: { id: true } });
    const moved = await prisma.note.findMany({
      where: { matterId: matter.id },
      select: { id: true, leadId: true, parentNoteId: true },
    });
    // Both notes moved (exactly-one-of scope holds), the reply still
    // threads under its root, and the reaction rode along.
    expect(moved).toHaveLength(2);
    for (const n of moved) expect(n.leadId).toBeNull();
    expect(moved.find((n) => n.id !== root.id)!.parentNoteId).toBe(root.id);
    expect(await prisma.noteReaction.count({ where: { noteId: root.id } })).toBe(1);
    // The other lead's note stayed lead-scoped.
    expect(await prisma.note.count({ where: { leadId: otherLead.id } })).toBe(1);

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId: matter.id, type: "note" },
      select: { title: true },
    });
    expect(log.title).toBe("2 intake notes carried forward");
  });

  test("re-homes lead tasks and events onto the new matter", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    await prisma.task.create({ data: { leadId, title: "Call back" } });
    await prisma.task.create({ data: { leadId, title: "Request records" } });
    await prisma.calendarEvent.create({
      data: {
        leadId,
        createdById: userId,
        title: "Consultation",
        startTime: new Date("2026-11-02T10:00:00Z"),
        endTime: new Date("2026-11-02T11:00:00Z"),
      },
    });
    const firmWide = await prisma.task.create({
      data: { title: "Firm-wide" },
      select: { id: true },
    });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({ select: { id: true } });
    expect(await prisma.task.count({ where: { matterId: matter.id, leadId: null } })).toBe(2);
    expect(await prisma.calendarEvent.count({ where: { matterId: matter.id, leadId: null } })).toBe(
      1,
    );
    expect(await prisma.task.count({ where: { leadId } })).toBe(0);
    expect(await prisma.calendarEvent.count({ where: { leadId } })).toBe(0);
    // A firm-wide task is untouched.
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: firmWide.id } })).matterId,
    ).toBeNull();

    const titles = (
      await prisma.activityLog.findMany({
        where: { matterId: matter.id },
        select: { title: true },
      })
    ).map((l) => l.title);
    expect(titles).toContain("2 intake tasks carried forward");
    expect(titles).toContain("1 intake event carried forward");
  });

  test("conversion moves every user's lead threads to the matter", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const other = await seedUser({
      firmId: (
        await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { firmId: true } })
      ).firmId!,
      email: "second@example.com",
    });
    const mk = async (uid: string, addr: string) =>
      (
        await prisma.emailAccount.create({
          data: { userId: uid, emailAddress: addr, accessToken: "t", refreshToken: "r" },
          select: { id: true },
        })
      ).id;
    const a1 = await mk(userId, "a1@example.com");
    const a2 = await mk(other.userId, "a2@example.com");
    for (const accountId of [a1, a2]) {
      await prisma.emailThread.create({
        data: { accountId, leadId, subject: "Intake", lastMessageAt: new Date() },
      });
    }

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({ select: { id: true } });
    expect(await prisma.emailThread.count({ where: { matterId: matter.id, leadId: null } })).toBe(
      2,
    );
    expect(await prisma.emailThread.count({ where: { leadId } })).toBe(0);
    const titles = (
      await prisma.activityLog.findMany({ where: { matterId: matter.id }, select: { title: true } })
    ).map((l) => l.title);
    expect(titles).toContain("2 email threads carried forward");
  });

  test("no email threads: no carried-over timeline entry", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);
    const matter = await prisma.matter.findFirstOrThrow({ select: { id: true } });
    const titles = (
      await prisma.activityLog.findMany({ where: { matterId: matter.id }, select: { title: true } })
    ).map((l) => l.title);
    expect(titles.some((t) => t.includes("email thread"))).toBe(false);
  });

  test("re-homes lead folders and documents onto the new matter", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const parent = await prisma.documentFolder.create({ data: { leadId, name: "Records" } });
    const child = await prisma.documentFolder.create({
      data: { leadId, name: "Sub", parentId: parent.id },
    });
    const nested = await prisma.document.create({
      data: { leadId, name: "a.pdf", folderId: child.id },
    });
    await prisma.document.create({ data: { leadId, name: "b.pdf" } });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({ select: { id: true } });
    expect(
      await prisma.documentFolder.count({ where: { matterId: matter.id, leadId: null } }),
    ).toBe(2);
    expect(await prisma.document.count({ where: { matterId: matter.id, leadId: null } })).toBe(2);
    expect(await prisma.documentFolder.count({ where: { leadId } })).toBe(0);
    expect(await prisma.document.count({ where: { leadId } })).toBe(0);
    expect(
      (await prisma.documentFolder.findUniqueOrThrow({ where: { id: child.id } })).parentId,
    ).toBe(parent.id);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: nested.id } })).folderId).toBe(
      child.id,
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId: matter.id, title: { contains: "intake document" } },
      select: { title: true },
    });
    expect(log.title).toBe("2 intake documents carried forward");
  });

  test("a protected records-request folder keeps its kind and link on the matter and stays protected", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const c = await prisma.contact.create({
      data: { name: "St. Mary's", type: "medical_provider" },
      select: { id: true },
    });
    const req = await prisma.recordsRequest.create({
      data: {
        leadId,
        custodianContactId: c.id,
        adHocTypeName: "Billing",
        subject: "Bills",
        status: "sent",
        ownerId: userId,
      },
    });
    const folder = await prisma.documentFolder.create({
      data: {
        leadId,
        name: "Bills",
        systemKind: "records_request",
        recordsRequestId: req.id,
      },
    });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const after = await prisma.documentFolder.findUniqueOrThrow({ where: { id: folder.id } });
    expect(after.matterId).not.toBeNull();
    expect(after.leadId).toBeNull();
    expect(after.systemKind).toBe("records_request");
    expect(after.recordsRequestId).toBe(req.id);
    const res = await renameFolder(folder.id, "Renamed");
    expect(res.ok).toBe(false);
    expect((await prisma.documentFolder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe(
      "Bills",
    );
  });

  test("no intake notes → no notes roll-forward log", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);
    expect(await prisma.activityLog.count({ where: { type: "note" } })).toBe(0);
  });
});

describe("convertLeadToMatter — intake records requests", () => {
  async function seedReq(leadId: string, over: Record<string, unknown> = {}) {
    const c = await prisma.contact.create({
      data: { name: "St. Mary's", type: "medical_provider" },
      select: { id: true },
    });
    return prisma.recordsRequest.create({
      data: {
        leadId,
        custodianContactId: c.id,
        adHocTypeName: "Billing",
        subject: "Bills",
        status: "sent",
        ownerId: userId,
        ...over,
      },
    });
  }

  test("carries requests, tasks and letters to the matter and books paid fees as expenses", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const paid = await seedReq(leadId, {
      feeAmount: "15.00",
      feePaidAt: new Date("2026-10-10T00:00:00Z"),
    });
    const free = await seedReq(leadId, {
      subject: "Zero",
      feeAmount: "0.00",
      feePaidAt: new Date("2026-10-10T00:00:00Z"),
    });
    const unpaid = await seedReq(leadId, { subject: "Unpaid", feeAmount: "9.00" });
    const task = await prisma.task.create({
      data: { leadId, title: "Follow up", recordsRequestId: paid.id },
    });
    const doc = await prisma.document.create({
      data: {
        leadId,
        name: "letter.pdf",
        recordsRequestId: paid.id,
        recordsRequestRole: "request_letter",
      },
    });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({ select: { id: true } });
    const p = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: paid.id } });
    expect(p.matterId).toBe(matter.id);
    expect(p.leadId).toBeNull();
    expect(p.expenseId).not.toBeNull();
    const exp = await prisma.expense.findUniqueOrThrow({ where: { id: p.expenseId! } });
    expect(exp).toMatchObject({
      matterId: matter.id,
      category: "records",
      billable: true,
      loggedBy: userId,
      description: "Records \u2014 St. Mary's (Billing)",
    });
    expect(exp.amount.toFixed(2)).toBe("15.00");
    expect(exp.date.toISOString().slice(0, 10)).toBe("2026-10-10");
    for (const id of [free.id, unpaid.id]) {
      const r = await prisma.recordsRequest.findUniqueOrThrow({ where: { id } });
      expect(r.matterId).toBe(matter.id);
      expect(r.expenseId).toBeNull();
    }
    expect(await prisma.expense.count()).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).matterId).toBe(
      matter.id,
    );
    const d = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(d.matterId).toBe(matter.id);
    expect(d.recordsRequestId).toBe(paid.id);

    const titles = (
      await prisma.activityLog.findMany({
        where: { matterId: matter.id },
        select: { title: true },
      })
    ).map((l) => l.title);
    expect(titles).toContain("3 intake records requests carried forward");
    expect(titles).toContain("1 records fee added as an expense");
  });

  test("a lead fee saved concurrently with conversion never leaves a paid fee without an Expense", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const req = await seedReq(leadId);
    const fee = new FormData();
    fee.set("feeAmount", "25.00");
    fee.set("feePaidAt", "2026-10-20");
    const results = await Promise.allSettled([
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
      saveRecordsFee(req.id, { status: "idle" }, fee),
    ]);
    const conv = results[0];
    expect(conv.status).toBe("rejected");
    expect(String((conv as PromiseRejectedResult).reason)).toMatch(/^Error: REDIRECT:/);
    expect(results[1].status).toBe("fulfilled");
    const after = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.leadId).toBeNull();
    expect(after.matterId).not.toBeNull();
    expect(after.feeAmount?.toFixed(2)).toBe("25.00");
    expect(after.expenseId).not.toBeNull();
    expect(await prisma.expense.count()).toBe(1);
  });

  test("singular log and no logs when there is nothing to carry", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    await seedReq(leadId);
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);
    const titles = (await prisma.activityLog.findMany({ select: { title: true } })).map(
      (l) => l.title,
    );
    expect(titles).toContain("1 intake records request carried forward");
    expect(titles.some((t) => t.includes("records fee"))).toBe(false);
  });
});

describe("convertLeadToMatter — automatic defaults (ADR-019)", () => {
  test("applies the area's defaults, owned by the converting attorney, and logs provenance", async () => {
    const { areaId, stageId } = await seedArea({ hasSol: true, periodDays: 730 });
    const { leadId } = await seedIntakeLead({
      dateOfIncident: new Date("2026-03-10T00:00:00.000Z"),
    });
    const rule = await prisma.deadlineRule.create({
      data: { title: "CGIA notice", anchor: "incident_date", offsetDays: 182 },
    });
    const list = await prisma.taskList.create({
      data: {
        name: "§1983 intake",
        items: { create: [{ title: "Send engagement letter", assignTo: "lead" }] },
      },
    });
    await prisma.autoApply.createMany({
      data: [
        { practiceAreaId: areaId, deadlineRuleId: rule.id },
        { practiceAreaId: null, taskListId: list.id },
      ],
    });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({ select: { id: true } });
    const generated = await prisma.deadline.findFirstOrThrow({
      where: { matterId: matter.id, deadlineRuleId: rule.id },
    });
    expect(generated.ownerId).toBe(userId);
    expect(generated.dueDate.toISOString().slice(0, 10)).toBe("2026-09-08");
    const task = await prisma.task.findFirstOrThrow({ where: { matterId: matter.id } });
    expect(task).toMatchObject({
      title: "Send engagement letter",
      ownerId: userId,
      taskListId: list.id,
    });

    const titles = (
      await prisma.activityLog.findMany({
        where: { matterId: matter.id },
        orderBy: { timestamp: "asc" },
      })
    ).map((l) => l.title);
    expect(titles).toContain("Converted from lead: Priya Patel");
    expect(titles).toContain("Automatic defaults applied: 1 deadline, 1 task (§1983 intake)");
  });

  test("no defaults → conversion still logs where the matter came from", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead({ conflictCheck: "clear" });
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);
    const titles = (await prisma.activityLog.findMany()).map((l) => l.title);
    expect(titles).toEqual(["Converted from lead: Priya Patel"]);
  });
});

// ── Conflict-check audit on conversion (F267) ───────────────────────────

describe("convertLeadToMatter — conflict gate (ADR-050)", () => {
  const conversionTitles = async (): Promise<string[]> =>
    (await prisma.activityLog.findMany({ orderBy: { timestamp: "asc" } })).map((l) => l.title);
  /** A directory contact sharing the lead's name ("Priya Patel"). */
  const seedNamesake = (conflictStatus = "clear") =>
    prisma.contact.create({
      data: { name: "Priya Patel", type: "witness", conflictStatus },
    });

  test("a clear live check converts and adds no conflict entry", async () => {
    const { areaId, stageId } = await seedArea({});
    // A stale stored status doesn't matter: the live check decides.
    const { leadId } = await seedIntakeLead({ conflictCheck: "pending" });
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);
    expect(
      (await conversionTitles()).some((t) => t.startsWith("Converted with conflict check")),
    ).toBe(false);
  });

  test("a live conflict blocks conversion even when the stored check says clear", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead({ conflictCheck: "clear" });
    await seedNamesake("flagged");
    const res = await convertLeadToMatter(
      leadId,
      { status: "idle" },
      convertForm({ areaId, stageId }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/found a conflict/);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.stage).toBe("new");
    expect(lead.conflictCheck).toBe("conflict");
    expect(await prisma.matter.count()).toBe(0);
  });

  test("possible conflicts need the review tick; with it, conversion goes through and is logged", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();
    await seedNamesake();

    const first = await convertLeadToMatter(
      leadId,
      { status: "idle" },
      convertForm({ areaId, stageId }),
    );
    expect(first).toEqual({ status: "error", conflictWarnings: 1 });
    expect(await prisma.matter.count()).toBe(0);

    const fd = convertForm({ areaId, stageId });
    fd.set("conflictWarningsReviewed", "true");
    await expect(convertLeadToMatter(leadId, { status: "idle" }, fd)).rejects.toThrow(/^REDIRECT:/);
    const row = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Converted with conflict check: warn (reviewed)" },
    });
    expect(row.matterId).not.toBeNull();
    expect(row.detail).toContain(leadId);
    expect(row.detail).toContain("1 possible conflict acknowledged");
  });

  test("a recorded override converts despite a live conflict, and says so", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead({ conflictCheck: "override" });
    await seedNamesake("flagged");
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);
    expect(await conversionTitles()).toContain("Converted with conflict check: override");
    // The override is not overwritten by the live result.
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.conflictCheck).toBe("override");
  });
});

// ── Audit labelling + date-only description ─────────────────────────────

describe("lead audit and description details", () => {
  test("the decline audit entry is labelled with the Intake source, not Documents", async () => {
    const { leadId } = await seedIntakeLead();
    await declineLead(leadId, { status: "idle" }, declineForm("No case"));
    const row = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Lead declined" } },
    });
    expect(row.source).toBe("Intake");
  });

  test("the matter description carries the incident date as its calendar day", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead({
      dateOfIncident: new Date("2026-04-15T00:00:00.000Z"),
    });
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);
    const matter = await prisma.matter.findFirstOrThrow({
      where: { name: "Patel v. Doe" },
    });
    expect(matter.description).toContain("Date of incident: 2026-04-15");
  });
});

// ── Conversion integrity ────────────────────────────────────────────────

/** Make the next pre-transaction `lead.findUnique` report a stale
 *  stage, simulating a request that read the lead before another one
 *  committed. */
function stubStaleLeadRead(staleStage: string) {
  const real = prisma.lead.findUnique.bind(prisma.lead) as (a: unknown) => Promise<object | null>;
  return vi.spyOn(prisma.lead, "findUnique").mockImplementationOnce((async (args: unknown) => {
    const row = await real(args);
    return row ? { ...row, stage: staleStage } : row;
  }) as never);
}

describe("convertLeadToMatter — client party row", () => {
  test("creates the client MatterContact row (lead with a Contact)", async () => {
    const { areaId, stageId } = await seedArea({});
    const contact = await prisma.contact.create({
      data: { name: "Priya Patel", type: "client", email: "priya@example.com" },
      select: { id: true },
    });
    const lead = await prisma.lead.create({
      data: { name: "Priya Patel", contactId: contact.id },
      select: { id: true },
    });

    await expect(
      convertLeadToMatter(lead.id, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/REDIRECT:/);

    const matter = await prisma.matter.findFirstOrThrow({
      select: { id: true, clientId: true },
    });
    expect(matter.clientId).toBe(contact.id);
    const rows = await prisma.matterContact.findMany({
      where: { matterId: matter.id },
      select: { contactId: true, category: true },
    });
    expect(rows).toEqual([{ contactId: contact.id, category: "client" }]);
  });

  test("creates the client MatterContact row (legacy lead without a Contact)", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead();

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/REDIRECT:/);

    const matter = await prisma.matter.findFirstOrThrow({
      select: { id: true, clientId: true },
    });
    expect(matter.clientId).not.toBeNull();
    const rows = await prisma.matterContact.findMany({
      where: { matterId: matter.id },
      select: { contactId: true, category: true },
    });
    expect(rows).toEqual([{ contactId: matter.clientId, category: "client" }]);
  });
});

describe("convertLeadToMatter — idempotent under concurrency", () => {
  test("two simultaneous conversions create exactly one matter", async () => {
    const { areaId, stageId } = await seedArea({
      hasSol: true,
      periodDays: 730,
    });
    const { leadId } = await seedIntakeLead({
      dateOfIncident: new Date("2024-01-15T00:00:00.000Z"),
    });

    const attempts = await Promise.all(
      [0, 1].map(() =>
        convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })).then(
          (r) => ({ threw: false as const, r }),
          (e: Error) => ({ threw: true as const, message: e.message }),
        ),
      ),
    );

    // Winner reaches the redirect; loser gets the form error.
    expect(attempts.filter((a) => a.threw)).toHaveLength(1);
    const loser = attempts.find((a) => !a.threw);
    expect(loser && !loser.threw && loser.r.errors?._form?.[0]).toMatch(/already converted/i);

    expect(await prisma.matter.count()).toBe(1);
    expect(await prisma.deadline.count()).toBe(1); // one SOL deadline
    const matter = await prisma.matter.findFirstOrThrow({
      select: { id: true },
    });
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true, convertedMatterId: true },
    });
    expect(lead).toEqual({ stage: "converted", convertedMatterId: matter.id });
  });

  test("a stale 'new' read cannot convert an already-converted lead", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead({ stage: "converted" });
    const spy = stubStaleLeadRead("new");

    const res = await convertLeadToMatter(
      leadId,
      { status: "idle" },
      convertForm({ areaId, stageId }),
    );
    spy.mockRestore();

    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/already converted/i);
    expect(await prisma.matter.count()).toBe(0);
  });
});

describe("declineLead — idempotent under concurrency", () => {
  test("a stale 'new' read cannot flip a converted lead to declined", async () => {
    const { leadId } = await seedIntakeLead({ stage: "converted" });
    const spy = stubStaleLeadRead("new");

    const res = await declineLead(leadId, { status: "idle" }, declineForm("too late"));
    spy.mockRestore();

    expect(res.status).toBe("error");
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true, declineReason: true },
    });
    expect(lead.stage).toBe("converted");
    expect(lead.declineReason).toBeNull();
    expect(
      await prisma.activityLog.count({
        where: { title: { startsWith: "Lead declined" } },
      }),
    ).toBe(0);
  });

  test("declining twice is a no-op: one audit row, reason untouched", async () => {
    const { leadId } = await seedIntakeLead();
    const first = await declineLead(leadId, { status: "idle" }, declineForm("Statute already ran"));
    expect(first.status).toBe("ok");

    // A stale tab / double submit, even with an empty reason.
    const second = await declineLead(leadId, { status: "idle" }, declineForm(""));
    expect(second.status).toBe("error");
    expect(second.errors?._form?.[0]).toMatch(/already declined/i);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true, declineReason: true },
    });
    expect(lead).toEqual({
      stage: "declined",
      declineReason: "Statute already ran",
    });
    expect(
      await prisma.activityLog.count({
        where: { title: { startsWith: "Lead declined" } },
      }),
    ).toBe(1);
  });

  test("a stale 'new' read cannot re-decline an already-declined lead", async () => {
    const { leadId } = await seedIntakeLead({ stage: "declined" });
    await prisma.lead.update({
      where: { id: leadId },
      data: { declineReason: "original" },
    });
    const spy = stubStaleLeadRead("new");

    const res = await declineLead(leadId, { status: "idle" }, declineForm("overwrite"));
    spy.mockRestore();

    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/already declined/i);
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { declineReason: true },
    });
    expect(lead.declineReason).toBe("original");
    expect(
      await prisma.activityLog.count({
        where: { title: { startsWith: "Lead declined" } },
      }),
    ).toBe(0);
  });

  test("two simultaneous declines log exactly one decision", async () => {
    const { leadId } = await seedIntakeLead();
    const results = await Promise.all(
      ["first", "second"].map((reason) =>
        declineLead(leadId, { status: "idle" }, declineForm(reason)),
      ),
    );
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(
      await prisma.activityLog.count({
        where: { title: { startsWith: "Lead declined" } },
      }),
    ).toBe(1);
  });
});

describe("convertLeadToMatter — vs. decline", () => {
  test("a decline committed after convert's read is not overwritten", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead({ stage: "declined" });
    await prisma.lead.update({
      where: { id: leadId },
      data: { declineReason: "Statute already ran" },
    });
    // convert read the lead as 'new' before the decline committed.
    const spy = stubStaleLeadRead("new");

    const res = await convertLeadToMatter(
      leadId,
      { status: "idle" },
      convertForm({ areaId, stageId }),
    );
    spy.mockRestore();

    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/declined/i);
    expect(await prisma.matter.count()).toBe(0);
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true, declineReason: true, convertedMatterId: true },
    });
    expect(lead).toEqual({
      stage: "declined",
      declineReason: "Statute already ran",
      convertedMatterId: null,
    });
  });

  test("converting a lead that was declined when read clears its decline reason", async () => {
    const { areaId, stageId } = await seedArea({});
    const { leadId } = await seedIntakeLead({ stage: "declined" });
    await prisma.lead.update({
      where: { id: leadId },
      data: { declineReason: "Changed their mind later" },
    });

    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/^REDIRECT:/);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true, declineReason: true },
    });
    expect(lead).toEqual({ stage: "converted", declineReason: null });
  });
});

// ── createLead (New intake form) ────────────────────────────────────────

describe("createLead", () => {
  // Typed loosely on purpose: the form posts whatever fields it has.
  const intakeForm = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const submit = (fields: Record<string, string>) =>
    createLead({ status: "idle" }, intakeForm(fields));

  test("new person: creates a client contact (with primary phone), the lead, and runs the conflict check", async () => {
    await expect(
      submit({
        name: "Dana Reyes",
        email: "Dana@Example.com",
        phone: "303-555-0142",
        source: "referral",
        sourceDetail: "referred by Fox",
        summary: "Excessive force at traffic stop",
        dateOfIncident: "2026-09-30",
        location: "Denver",
        priorCounsel: "on",
      }),
    ).rejects.toThrow(/^REDIRECT:\/intake\//);
    expect(vi.mocked(requirePermission)).toHaveBeenCalledWith("intake.create");

    const lead = await prisma.lead.findFirstOrThrow({
      include: { contact: { include: { phones: true } } },
    });
    expect(lead).toMatchObject({
      name: "Dana Reyes",
      email: "dana@example.com",
      source: "referral",
      priorCounsel: true,
      stage: "new",
    });
    expect(lead.dateOfIncident?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(lead.contact).toMatchObject({ type: "client", email: "dana@example.com" });
    expect(lead.contact?.phones.map((p) => [p.number, p.isPrimary])).toEqual([
      ["303-555-0142", true],
    ]);
    // Conflict check ran on save.
    expect(lead.conflictCheck).toBe("clear");
    expect(lead.conflictCheckedAt).not.toBeNull();
    const log = await prisma.activityLog.findFirstOrThrow({ where: { userId } });
    expect(log.title).toBe("New intake: Dana Reyes");
    expect(log.detail).toMatch(/new contact · conflict check clear/);
  });

  test("picked existing contact: links it, creates no new contact", async () => {
    const existing = await prisma.contact.create({
      data: { name: "Repeat Caller", type: "witness", email: "repeat@example.com" },
    });
    await expect(submit({ contactId: existing.id, source: "phone" })).rejects.toThrow(/^REDIRECT:/);
    expect(await prisma.contact.count()).toBe(1);
    const lead = await prisma.lead.findFirstOrThrow();
    expect(lead).toMatchObject({
      contactId: existing.id,
      name: "Repeat Caller",
      email: "repeat@example.com",
    });
    // The lead's own contact never matches itself → still "clear".
    expect(lead.conflictCheck).toBe("clear");
  });

  test("typed email matching an active contact links to it (case-insensitive)", async () => {
    const existing = await prisma.contact.create({
      data: { name: "Pat Moore", type: "client", email: "pat@example.com" },
    });
    await expect(submit({ name: "Patricia Moore", email: "PAT@example.com" })).rejects.toThrow(
      /^REDIRECT:/,
    );
    expect(await prisma.contact.count()).toBe(1);
    expect((await prisma.lead.findFirstOrThrow()).contactId).toBe(existing.id);
  });

  test("never links to an inactive or merged contact", async () => {
    await prisma.contact.create({
      data: { name: "Old Record", type: "client", email: "gone@example.com", isActive: false },
    });
    await expect(submit({ name: "New Record", email: "gone@example.com" })).rejects.toThrow(
      /^REDIRECT:/,
    );
    expect(await prisma.contact.count()).toBe(2);
    const lead = await prisma.lead.findFirstOrThrow({ include: { contact: true } });
    expect(lead.contact?.name).toBe("New Record");
  });

  test("flags a conflict when the person is opposing counsel on a matter", async () => {
    await prisma.contact.create({
      data: { name: "Opposing Firm Person", type: "opposing_counsel", email: "opp@lawfirm.com" },
    });
    await expect(submit({ name: "Opposing Firm Person" })).rejects.toThrow(/^REDIRECT:/);
    const lead = await prisma.lead.findFirstOrThrow();
    expect(lead.conflictCheck).not.toBe("clear");
  });

  test("validation keeps the draft and writes nothing", async () => {
    const noName = await submit({ email: "x@example.com", summary: "draft text" });
    expect(noName.status).toBe("error");
    expect(noName.errors?.name).toBeTruthy();
    expect(noName.values?.summary).toBe("draft text");

    const badDate = await submit({ name: "A Person", dateOfIncident: "2026-02-30" });
    expect(badDate.errors?.dateOfIncident).toEqual(["Enter a valid date"]);

    const badEmail = await submit({ name: "A Person", email: "not-an-email" });
    expect(badEmail.errors?.email).toBeTruthy();

    const stale = await submit({ contactId: "missing-contact" });
    expect(stale.errors?.name?.[0]).toMatch(/no longer available/);

    expect(await prisma.lead.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
  });
});

describe("convertLeadToMatter — restricted intake carries its wall (ADR-049)", () => {
  async function convert(leadId: string) {
    const { areaId, stageId } = await seedArea({});
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/REDIRECT:/);
    return prisma.matter.findFirstOrThrow({
      select: {
        id: true,
        restricted: true,
        teamMembers: { select: { userId: true, role: true }, orderBy: { createdAt: "asc" } },
      },
    });
  }

  test("a restricted lead's matter is restricted and inherits the team with roles", async () => {
    const { firmId } = await seedFirm({ name: "Second firm row" });
    const { userId: para } = await seedUser({ firmId });
    const { leadId } = await seedIntakeLead();
    await prisma.lead.update({ where: { id: leadId }, data: { restricted: true } });
    await prisma.leadTeamMember.createMany({
      data: [
        { leadId, userId, role: "paralegal" }, // the converter, below
        { leadId, userId: para, role: "investigator" },
      ],
    });

    const matter = await convert(leadId);
    expect(matter.restricted).toBe(true);
    const roles = Object.fromEntries(matter.teamMembers.map((m) => [m.userId, m.role]));
    // The converter is the lead exactly once, whatever their intake role.
    expect(roles).toEqual({ [userId]: "lead", [para]: "investigator" });
    expect(matter.teamMembers).toHaveLength(2);
  });

  test("a second 'lead' on the intake team becomes co-counsel on the matter", async () => {
    const { firmId } = await seedFirm({ name: "Third firm row" });
    const { userId: other } = await seedUser({ firmId });
    const { leadId } = await seedIntakeLead();
    await prisma.lead.update({ where: { id: leadId }, data: { restricted: true } });
    await prisma.leadTeamMember.createMany({
      data: [
        { leadId, userId, role: "co_counsel" },
        { leadId, userId: other, role: "lead" },
      ],
    });
    const matter = await convert(leadId);
    const roles = Object.fromEntries(matter.teamMembers.map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [userId]: "lead", [other]: "co_counsel" });
  });

  test("restricting while a conversion is in flight still yields a restricted matter", async () => {
    // The pre-claim read sees the lead as open; the wall lands before
    // the claim. The matter must follow the locked row, not the stale read.
    const { leadId } = await seedIntakeLead();
    const stale = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    await prisma.lead.update({ where: { id: leadId }, data: { restricted: true } });
    await prisma.leadTeamMember.create({ data: { leadId, userId } });
    const spy = vi.spyOn(prisma.lead, "findUnique").mockResolvedValueOnce(stale as never);
    try {
      const matter = await convert(leadId);
      expect(matter.restricted).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("an open lead converts as today: unrestricted, converter only", async () => {
    const { leadId } = await seedIntakeLead();
    const matter = await convert(leadId);
    expect(matter.restricted).toBe(false);
    expect(matter.teamMembers).toEqual([{ userId, role: "lead" }]);
  });

  test("a non-member can't convert a restricted lead (404, nothing created)", async () => {
    const { firmId } = await seedFirm({ name: "Fourth firm row" });
    const { userId: owner } = await seedUser({ firmId });
    const { leadId } = await seedIntakeLead();
    await prisma.lead.update({ where: { id: leadId }, data: { restricted: true } });
    await prisma.leadTeamMember.create({ data: { leadId, userId: owner } });
    const { areaId, stageId } = await seedArea({});
    await expect(
      convertLeadToMatter(leadId, { status: "idle" }, convertForm({ areaId, stageId })),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
    expect(await prisma.matter.count()).toBe(0);
  });
});

describe("convertLeadToMatter — the dialog picks the lead attorney", () => {
  async function convertWith(leadId: string, leadAttorneyId: string | null) {
    const { areaId, stageId } = await seedArea({ hasSol: true, periodDays: 730 });
    const fd = convertForm({ areaId, stageId });
    if (leadAttorneyId === null) fd.delete("leadAttorneyId");
    else fd.set("leadAttorneyId", leadAttorneyId);
    return convertLeadToMatter(leadId, { status: "idle" }, fd);
  }
  async function seedOtherAttorney(name: string) {
    const { firmId } = await seedFirm({ name });
    const { userId: id } = await seedUser({ firmId });
    await seedBarAdmission({ userId: id, number: "99999" });
    return id;
  }
  const team = () =>
    prisma.matterTeamMember
      .findMany({ select: { userId: true, role: true } })
      .then((rows) => Object.fromEntries(rows.map((m) => [m.userId, m.role])));

  test("the picked attorney leads and owns the SOL deadline; the converter is not added", async () => {
    const picked = await seedOtherAttorney("Pick firm row");
    const { leadId } = await seedIntakeLead({
      dateOfIncident: new Date("2024-01-15T00:00:00.000Z"),
    });
    await expect(convertWith(leadId, picked)).rejects.toThrow(/^REDIRECT:/);
    expect(await team()).toEqual({ [picked]: "lead" });
    const deadline = await prisma.deadline.findFirstOrThrow({
      where: { sourceType: "statute_of_limitations" },
      select: { ownerId: true },
    });
    expect(deadline.ownerId).toBe(picked);
  });

  test("the converter on the intake team keeps their mapped role; another intake lead becomes co-counsel", async () => {
    const picked = await seedOtherAttorney("Pick firm row");
    const other = await seedOtherAttorney("Other firm row");
    const { leadId } = await seedIntakeLead();
    await prisma.lead.update({ where: { id: leadId }, data: { restricted: true } });
    await prisma.leadTeamMember.createMany({
      data: [
        { leadId, userId, role: "paralegal" },
        { leadId, userId: picked, role: "investigator" },
        { leadId, userId: other, role: "lead" },
      ],
    });
    await expect(convertWith(leadId, picked)).rejects.toThrow(/^REDIRECT:/);
    expect(await team()).toEqual({
      [picked]: "lead",
      [userId]: "paralegal",
      [other]: "co_counsel",
    });
  });

  test.each([
    ["missing", null],
    ["not an attorney", "nobody"],
  ])("a %s leadAttorneyId is refused and nothing is created", async (_label, which) => {
    let id = which;
    if (which === "nobody") {
      const { firmId } = await seedFirm({ name: "No bar firm row" });
      id = (await seedUser({ firmId })).userId;
    }
    const { leadId } = await seedIntakeLead();
    const res = await convertWith(leadId, id);
    expect(res).toEqual({
      status: "error",
      errors: { leadAttorneyId: [LEAD_NOT_ATTORNEY] },
    });
    expect(await prisma.matter.count()).toBe(0);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).stage).not.toBe(
      "converted",
    );
  });
});

// ── originating-document gate ───────────────────────────────────────────

describe("convertLeadToMatter — originating-document gate", () => {
  async function switchOn() {
    await prisma.firm.updateMany({ data: { requireOriginatingDoc: true } });
  }
  async function leadDoc(leadId: string, status = "active") {
    return prisma.document.create({
      data: { leadId, name: "Retainer.pdf", status },
      select: { id: true },
    });
  }
  function form(base: { areaId: string; stageId: string }, extra: Record<string, string> = {}) {
    const fd = convertForm(base);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  }
  const run = (leadId: string, fd: FormData) => convertLeadToMatter(leadId, { status: "idle" }, fd);

  test("switch on, nothing supplied: every piece is refused, no matter created", async () => {
    await switchOn();
    const base = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const res = await run(leadId, form(base));
    expect(res.status).toBe("error");
    expect(res.errors?.originatingDocumentId).toBeTruthy();
    expect(res.errors?.agreementStatus).toBeTruthy();
    expect(await prisma.matter.count()).toBe(0);
  });

  test("switch on, signed but no date or no document: refused", async () => {
    await switchOn();
    const base = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const doc = await leadDoc(leadId);
    const noDate = await run(
      leadId,
      form(base, { agreementStatus: "signed", originatingDocumentId: doc.id }),
    );
    expect(noDate.errors?.agreementSignedDate).toBeTruthy();
    const noDoc = await run(
      leadId,
      form(base, { agreementStatus: "signed", agreementSignedDate: "2020-01-02" }),
    );
    expect(noDoc.errors?.originatingDocumentId).toBeTruthy();
    expect(await prisma.matter.count()).toBe(0);
  });

  test("a document from another lead (or archived) does not count", async () => {
    await switchOn();
    const base = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const other = await seedIntakeLead();
    const foreign = await leadDoc(other.leadId);
    const archived = await leadDoc(leadId, "archived");
    for (const id of [foreign.id, archived.id]) {
      const res = await run(
        leadId,
        form(base, {
          agreementStatus: "signed",
          agreementSignedDate: "2020-01-02",
          originatingDocumentId: id,
        }),
      );
      expect(res.errors?.originatingDocumentId).toBeTruthy();
    }
    expect(await prisma.matter.count()).toBe(0);
  });

  test("switch off: converts and writes a not_sent agreement", async () => {
    const base = await seedArea({});
    const { leadId } = await seedIntakeLead();
    await expect(run(leadId, form(base))).rejects.toThrow(/^REDIRECT:/);
    const a = await prisma.matterAgreement.findFirstOrThrow();
    expect(a.status).toBe("not_sent");
    expect(a.documentId).toBeNull();
    expect(a.signedDate).toBeNull();
  });

  test("success: agreement points at the re-homed document and is logged", async () => {
    await switchOn();
    const base = await seedArea({});
    const { leadId } = await seedIntakeLead();
    const doc = await leadDoc(leadId);
    await expect(
      run(
        leadId,
        form(base, {
          agreementStatus: "signed",
          agreementSignedDate: "2020-01-02",
          originatingDocumentId: doc.id,
        }),
      ),
    ).rejects.toThrow(/^REDIRECT:/);
    const matter = await prisma.matter.findFirstOrThrow({ select: { id: true } });
    const a = await prisma.matterAgreement.findFirstOrThrow();
    expect(a.matterId).toBe(matter.id);
    expect(a.status).toBe("signed");
    expect(a.signedDate).toEqual(new Date("2020-01-02T00:00:00.000Z"));
    expect(a.documentId).toBe(doc.id);
    const d = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(d.matterId).toBe(matter.id);
    expect(d.leadId).toBeNull();
    const log = await prisma.activityLog.findFirst({
      where: { matterId: matter.id, title: "Fee agreement signed 2020-01-02" },
    });
    expect(log).not.toBeNull();
  });
});

describe("convertLeadToMatter — billing type", () => {
  function withType(fd: FormData, t?: string): FormData {
    if (t === undefined) fd.delete("billingType");
    else fd.set("billingType", t);
    return fd;
  }

  test("an allowed type writes both matter columns per the mapping", async () => {
    const { areaId, stageId } = await seedArea({
      allowedBillingTypes: ["hourly", "court_appointed"],
      defaultBillingType: "hourly",
    });
    const { leadId } = await seedIntakeLead();

    await convertLeadToMatter(
      leadId,
      { status: "idle" },
      withType(convertForm({ areaId, stageId }), "court_appointed"),
    ).catch(() => undefined); // success redirects
    const m = await prisma.matter.findFirstOrThrow({
      select: { feeStructure: true, billingMode: true },
    });
    expect(m).toEqual({ feeStructure: "hourly", billingMode: "court_voucher" });
  });

  test("omitted type uses the area default", async () => {
    const { areaId, stageId } = await seedArea({
      allowedBillingTypes: ["flat", "hourly"],
      defaultBillingType: "flat",
    });
    const { leadId } = await seedIntakeLead();

    await convertLeadToMatter(
      leadId,
      { status: "idle" },
      withType(convertForm({ areaId, stageId })),
    ).catch(() => undefined);
    const m = await prisma.matter.findFirstOrThrow({
      select: { feeStructure: true, billingMode: true },
    });
    expect(m).toEqual({ feeStructure: "flat", billingMode: "client" });
  });

  test("a type the area does not offer is rejected; lead unclaimed, no matter", async () => {
    const { areaId, stageId } = await seedArea({
      allowedBillingTypes: ["hourly"],
      defaultBillingType: "hourly",
    });
    const { leadId } = await seedIntakeLead();

    const res = await convertLeadToMatter(
      leadId,
      { status: "idle" },
      withType(convertForm({ areaId, stageId }), "pro_bono"),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.billingType).toEqual(["Not offered for this practice area"]);
    expect(await prisma.matter.count()).toBe(0);
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true, convertedMatterId: true },
    });
    expect(lead).toEqual({ stage: "new", convertedMatterId: null });
  });
});
