/**
 * Integration tests for the lead conflict-check actions.
 *
 * Pins:
 *   - re-running the check does not match the lead against its own
 *     Contact (a fresh lead comes back "clear", not "warn")
 *   - audit entries identify the lead (name in the title, id in the
 *     detail) — ActivityLog has no lead reference, so a reviewer
 *     asking "who cleared the conflict on lead X" must be able to
 *     find the row
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  overrideLeadConflictCheck,
  runLeadConflictCheck,
} from "@/app/actions/conflict-check";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedLead,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId })).userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
});

describe("runLeadConflictCheck", () => {
  test("a lead's own Contact does not flag it: result is clear", async () => {
    const c = await seedContact({
      name: "Jessica Hale",
      email: "jhale@example.com",
    });
    const { leadId } = await seedLead({
      name: "Jessica Hale",
      email: "jhale@example.com",
      contactId: c.contactId,
    });

    const res = await runLeadConflictCheck(leadId);
    expect(res).toEqual({ ok: true, severity: "clear" });
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { conflictCheck: true },
    });
    expect(lead.conflictCheck).toBe("clear");
  });

  test("another contact with the same email still flags the lead", async () => {
    const own = await seedContact({
      name: "Jessica Hale",
      email: "jhale@example.com",
    });
    await seedContact({ name: "J. Hale", email: "jhale@example.com" });
    const { leadId } = await seedLead({
      name: "Jessica Hale",
      email: "jhale@example.com",
      contactId: own.contactId,
    });

    const res = await runLeadConflictCheck(leadId);
    expect(res.severity).toBe("warn");
  });

  test("the audit entry names the lead and carries its id", async () => {
    const c = await seedContact({ name: "Jessica Hale" });
    const { leadId } = await seedLead({
      name: "Jessica Hale",
      contactId: c.contactId,
    });

    await runLeadConflictCheck(leadId);

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Conflict check run on lead" } },
      select: { title: true, detail: true, userId: true },
    });
    expect(entry.title).toContain("Jessica Hale");
    expect(entry.detail).toContain(leadId);
    expect(entry.userId).toBe(userId);
  });
});

describe("overrideLeadConflictCheck", () => {
  test("the audit entry names the lead and carries its id + justification", async () => {
    // A second contact with the same email so the lead is flagged.
    await seedContact({ name: "Jessica Hale", email: "jhale@example.com" });
    const own = await seedContact({
      name: "Jessica Hale",
      email: "jhale@example.com",
    });
    const { leadId } = await seedLead({
      name: "Jessica Hale",
      email: "jhale@example.com",
      contactId: own.contactId,
    });
    expect((await runLeadConflictCheck(leadId)).severity).toBe("warn");

    const fd = new FormData();
    fd.set("notes", "Informed-consent waiver signed");
    const res = await overrideLeadConflictCheck(leadId, fd);
    expect(res.ok).toBe(true);

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Conflict check overridden" } },
      select: { title: true, detail: true },
    });
    expect(entry.title).toContain("Jessica Hale");
    expect(entry.detail).toContain(leadId);
    expect(entry.detail).toContain("Informed-consent waiver signed");
  });
});
