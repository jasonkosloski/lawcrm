/**
 * Integration tests for the time-entry action surface.
 *
 * Covers:
 *   - createTimeEntry: validation, matter existence, calendar-event
 *     linking, source field write
 *   - updateTimeEntry: validation, billed-row guard (regardless of
 *     the posted status), amount = hours × rate sync, field updates
 *   - setTimeEntryStatus: enum guard, missing-row guard, status
 *     update, billed-transition guards (no manual bill/unbill while
 *     an invoice is attached)
 *   - deleteTimeEntry: missing-row + billed-row guards
 *   - RBAC gates: each entry-point hits the right permission key,
 *     and edit/delete flow through `time_entries.{edit,delete}_any`
 *     when the actor isn't the original logger.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { Prisma } from "@/generated/prisma/client";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  createTimeEntry,
  deleteTimeEntry,
  setTimeEntryStatus,
  updateTimeEntry,
} from "@/app/actions/time-entries";
import { timeEntryInitialState } from "@/lib/time-entry-constants";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRequirePermission = vi.mocked(requirePermission);

let userId: string;
let otherUserId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "logger@example.com" });
  userId = u.userId;
  const u2 = await seedUser({ firmId, email: "other@example.com" });
  otherUserId = u2.userId;
  mockedGetUser.mockResolvedValue(userId);
  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── createTimeEntry ─────────────────────────────────────────────────────

const buildCreateForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("date", overrides.date ?? "2026-04-01");
  fd.set("hours", overrides.hours ?? "1.5");
  fd.set("activity", overrides.activity ?? "Drafting");
  fd.set("narrative", overrides.narrative ?? "");
  if (overrides.billable === "on") fd.set("billable", "on");
  if (overrides.calendarEventId) {
    fd.set("calendarEventId", overrides.calendarEventId);
  }
  return fd;
};

describe("createTimeEntry — validation", () => {
  test("rejects 0 hours", async () => {
    const res = await createTimeEntry(
      matterId,
      timeEntryInitialState,
      buildCreateForm({ hours: "0" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.hours?.length).toBeGreaterThan(0);
  });

  test("rejects > 24 hours", async () => {
    const res = await createTimeEntry(
      matterId,
      timeEntryInitialState,
      buildCreateForm({ hours: "25" })
    );
    expect(res.status).toBe("error");
  });

  test("rejects empty activity", async () => {
    const res = await createTimeEntry(
      matterId,
      timeEntryInitialState,
      buildCreateForm({ activity: "   " })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.length).toBeGreaterThan(0);
  });

  test("returns error when matter doesn't exist", async () => {
    const res = await createTimeEntry(
      "missing-matter",
      timeEntryInitialState,
      buildCreateForm({})
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/not found/i);
  });
});

describe("createTimeEntry — happy path", () => {
  test("persists the row with hours, activity, billable flag", async () => {
    const res = await createTimeEntry(
      matterId,
      timeEntryInitialState,
      buildCreateForm({
        hours: "2.5",
        activity: "Phone call",
        billable: "on",
        narrative: "Strategy chat",
      })
    );
    expect(res.status).toBe("ok");

    const rows = await prisma.timeEntry.findMany({ where: { matterId } });
    expect(rows).toHaveLength(1);
    // hours is a Float column, not Decimal — compare directly.
    expect(rows[0]!.hours).toBe(2.5);
    expect(rows[0]!.activity).toBe("Phone call");
    expect(rows[0]!.billable).toBe(true);
    expect(rows[0]!.narrative).toBe("Strategy chat");
    expect(rows[0]!.userId).toBe(userId);
  });

  test("source defaults to 'manual'; switches to 'calendar' when calendarEventId is present", async () => {
    // Create a calendar event so the FK resolves.
    const ev = await prisma.calendarEvent.create({
      data: {
        matterId,
        title: "Strategy call",
        startTime: new Date("2026-04-01T10:00:00Z"),
        endTime: new Date("2026-04-01T11:00:00Z"),
        type: "meeting",
      },
      select: { id: true },
    });

    await createTimeEntry(
      matterId,
      timeEntryInitialState,
      buildCreateForm({ calendarEventId: ev.id })
    );
    const linked = await prisma.timeEntry.findFirst({
      where: { matterId, calendarEventId: ev.id },
    });
    expect(linked!.source).toBe("calendar");

    await createTimeEntry(
      matterId,
      timeEntryInitialState,
      buildCreateForm({})
    );
    const manual = await prisma.timeEntry.findFirst({
      where: { matterId, calendarEventId: null },
    });
    expect(manual!.source).toBe("manual");
  });

  test("normalizes empty narrative to null", async () => {
    await createTimeEntry(
      matterId,
      timeEntryInitialState,
      buildCreateForm({ narrative: "" })
    );
    const row = await prisma.timeEntry.findFirst({ where: { matterId } });
    expect(row!.narrative).toBeNull();
  });
});

// ── updateTimeEntry ─────────────────────────────────────────────────────

const buildUpdateForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("date", overrides.date ?? "2026-04-01");
  fd.set("hours", overrides.hours ?? "1.5");
  fd.set("activity", overrides.activity ?? "Drafting");
  fd.set("narrative", overrides.narrative ?? "");
  fd.set("status", overrides.status ?? "draft");
  if (overrides.billable === "on") fd.set("billable", "on");
  return fd;
};

describe("updateTimeEntry", () => {
  test("rejects when entry doesn't exist", async () => {
    const res = await updateTimeEntry(
      "missing",
      timeEntryInitialState,
      buildUpdateForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/no longer exists/i);
  });

  test("billed entry edit is refused (must unbill first)", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      status: "billed",
    });
    const res = await updateTimeEntry(
      timeEntryId,
      timeEntryInitialState,
      buildUpdateForm({ status: "billed" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/billed/i);
  });

  test("billed guard can't be bypassed by posting a different status", async () => {
    // Regression: the guard used to fire only when the *form* also
    // said "billed" — posting "draft" (the schema default) slipped
    // through and mutated an invoiced entry.
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      hours: 1,
      status: "billed",
    });
    const res = await updateTimeEntry(
      timeEntryId,
      timeEntryInitialState,
      buildUpdateForm({ hours: "9", status: "draft" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/billed/i);
    // The row is untouched.
    const row = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
    expect(row!.hours).toBe(1);
    expect(row!.status).toBe("billed");
  });

  test("recomputes amount (hours × rate) when the entry has a rate", async () => {
    // Reachable path: rate/amount set via updateInvoiceLineItem,
    // invoice voided (entry back in WIP with rate intact), hours
    // edited here — amount must follow or the next WIP invoice
    // sums a stale Decimal.
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      hours: 1,
      rate: 250,
      amount: 250,
      status: "billable",
    });
    const res = await updateTimeEntry(
      timeEntryId,
      timeEntryInitialState,
      buildUpdateForm({ hours: "3", status: "billable" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
    expect(row!.hours).toBe(3);
    expect(row!.amount!.toString()).toBe("750");
  });

  test("leaves amount alone on rate-less (contingent) entries", async () => {
    const entry = await prisma.timeEntry.create({
      data: {
        matterId,
        userId,
        date: new Date(),
        hours: 1,
        activity: "Contingent work",
        status: "draft",
      },
      select: { id: true },
    });
    const res = await updateTimeEntry(
      entry.id,
      timeEntryInitialState,
      buildUpdateForm({ hours: "4" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(row!.hours).toBe(4);
    expect(row!.amount).toBeNull();
  });

  test("persists field updates on a draft entry", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      status: "draft",
    });
    const res = await updateTimeEntry(
      timeEntryId,
      timeEntryInitialState,
      buildUpdateForm({
        hours: "3",
        activity: "Updated activity",
        narrative: "More detail",
        status: "submitted",
      })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
    expect(row!.hours).toBe(3);
    expect(row!.activity).toBe("Updated activity");
    expect(row!.narrative).toBe("More detail");
    expect(row!.status).toBe("submitted");
  });
});

// ── setTimeEntryStatus ──────────────────────────────────────────────────

describe("setTimeEntryStatus", () => {
  test("rejects unknown status", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId });
    const res = await setTimeEntryStatus(timeEntryId, "garbage" as never);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown status/i);
  });

  test("rejects unknown id", async () => {
    const res = await setTimeEntryStatus("missing", "submitted");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  test("flips status on a known entry", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      status: "draft",
    });
    const res = await setTimeEntryStatus(timeEntryId, "submitted");
    expect(res.ok).toBe(true);
    const row = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
    expect(row!.status).toBe("submitted");
  });

  test("refuses manual transitions TO billed", async () => {
    // "billed" is owned by invoice generation — a hand flip would
    // create a billed entry with no invoice behind it.
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      status: "billable",
    });
    const res = await setTimeEntryStatus(timeEntryId, "billed");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invoice/i);
    const row = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
    expect(row!.status).toBe("billable");
  });

  test("refuses unbilling an entry that's still on an invoice", async () => {
    // Flipping billed→billable while invoiceId stays set strands the
    // entry: excluded from WIP yet still in the invoice's totals.
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-777",
        matterId,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 250,
        totalAmount: 250,
        paidAmount: 0,
      },
      select: { id: true },
    });
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      status: "billed",
      invoiceId: invoice.id,
    });
    const res = await setTimeEntryStatus(timeEntryId, "billable");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/void or delete/i);
    const row = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
    expect(row!.status).toBe("billed");
    expect(row!.invoiceId).toBe(invoice.id);
  });

  test("allows repairing a stranded billed entry with no invoice", async () => {
    // billed + invoiceId null shouldn't happen through the normal
    // pipeline, but if it does, the status flip is the escape hatch.
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      status: "billed",
      invoiceId: null,
    });
    const res = await setTimeEntryStatus(timeEntryId, "billable");
    expect(res.ok).toBe(true);
    const row = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
    expect(row!.status).toBe("billable");
  });
});

// ── deleteTimeEntry ─────────────────────────────────────────────────────

describe("deleteTimeEntry", () => {
  test("removes an unbilled entry", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      status: "billable",
    });
    const res = await deleteTimeEntry(timeEntryId);
    expect(res.ok).toBe(true);
    expect(
      await prisma.timeEntry.findUnique({ where: { id: timeEntryId } })
    ).toBeNull();
  });

  test("refuses billed entries (accounting hygiene)", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      status: "billed",
    });
    const res = await deleteTimeEntry(timeEntryId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/billed/i);
    // The row remains.
    expect(
      await prisma.timeEntry.findUnique({ where: { id: timeEntryId } })
    ).not.toBeNull();
  });

  test("returns error for unknown id", async () => {
    const res = await deleteTimeEntry("missing");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

// ── RBAC gates ──────────────────────────────────────────────────────────

describe("time-entries action gates", () => {
  test("createTimeEntry gates on time_entries.create", async () => {
    mockedRequirePermission.mockClear();
    await createTimeEntry(
      matterId,
      timeEntryInitialState,
      buildCreateForm({})
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
  });

  test("updateTimeEntry by author DOESN'T require .edit_any", async () => {
    mockedRequirePermission.mockClear();
    const { timeEntryId } = await seedTimeEntry({ matterId, userId });
    // Actor is the entry's author.
    await updateTimeEntry(
      timeEntryId,
      timeEntryInitialState,
      buildUpdateForm()
    );
    expect(mockedRequirePermission).not.toHaveBeenCalledWith(
      "time_entries.edit_any"
    );
  });

  test("updateTimeEntry by NON-author requires .edit_any", async () => {
    mockedRequirePermission.mockClear();
    // Entry was logged by `otherUserId`; current actor is `userId`.
    const entry = await prisma.timeEntry.create({
      data: {
        matterId,
        userId: otherUserId,
        date: new Date(),
        hours: 1,
        activity: "Logged by other",
        rate: new Prisma.Decimal(0),
        amount: new Prisma.Decimal(0),
        billable: false,
        status: "draft",
      },
      select: { id: true },
    });
    await updateTimeEntry(entry.id, timeEntryInitialState, buildUpdateForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "time_entries.edit_any"
    );
  });

  test("deleteTimeEntry by author DOESN'T require .delete_any", async () => {
    mockedRequirePermission.mockClear();
    const { timeEntryId } = await seedTimeEntry({ matterId, userId });
    await deleteTimeEntry(timeEntryId);
    expect(mockedRequirePermission).not.toHaveBeenCalledWith(
      "time_entries.delete_any"
    );
  });

  test("deleteTimeEntry by NON-author requires .delete_any", async () => {
    mockedRequirePermission.mockClear();
    const entry = await prisma.timeEntry.create({
      data: {
        matterId,
        userId: otherUserId,
        date: new Date(),
        hours: 1,
        activity: "Logged by other",
        rate: new Prisma.Decimal(0),
        amount: new Prisma.Decimal(0),
        billable: false,
        status: "draft",
      },
      select: { id: true },
    });
    await deleteTimeEntry(entry.id);
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "time_entries.delete_any"
    );
  });

  test("setTimeEntryStatus by NON-author requires .edit_any", async () => {
    mockedRequirePermission.mockClear();
    const entry = await prisma.timeEntry.create({
      data: {
        matterId,
        userId: otherUserId,
        date: new Date(),
        hours: 1,
        activity: "Logged by other",
        rate: new Prisma.Decimal(0),
        amount: new Prisma.Decimal(0),
        billable: false,
        status: "draft",
      },
      select: { id: true },
    });
    await setTimeEntryStatus(entry.id, "submitted");
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "time_entries.edit_any"
    );
  });
});
