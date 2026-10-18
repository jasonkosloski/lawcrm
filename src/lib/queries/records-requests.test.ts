/**
 * Integration tests for the records-request read queries: row shaping
 * (due-day math, overdue flag), the scope wall on the detail query and
 * the expense-lock flag.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getRecordsRequestDetail,
  getRecordsRequests,
} from "@/lib/queries/records-requests";
import type { RecordScope } from "@/lib/record-scope";
import {
  resetDb,
  seedContact,
  seedDocument,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const TZ = "America/Denver";
let userId: string;
let matterId: string;
let custodianId: string;
let M: RecordScope;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T18:00:00Z"));
  await resetDb();
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId, initials: "AB" })).userId;
  const area = await seedPracticeArea();
  matterId = (
    await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    })
  ).matterId;
  M = { kind: "matter", matterId };
  custodianId = (await seedContact({ name: "St. Mary's", type: "medical_provider" }))
    .contactId;
});

async function req(over: Record<string, unknown> = {}) {
  return prisma.recordsRequest.create({
    data: {
      matterId,
      custodianContactId: custodianId,
      adHocTypeName: "Billing",
      subject: "Bills",
      status: "sent",
      ownerId: userId,
      ...over,
    },
  });
}

describe("getRecordsRequests", () => {
  test("shapes rows: due days, overdue flag, ad hoc type name, owner initials", async () => {
    await req({ subject: "late", responseDueDate: new Date("2026-10-15T00:00:00Z") });
    await req({ subject: "soon", responseDueDate: new Date("2026-10-21T00:00:00Z") });
    await req({
      subject: "done-late",
      status: "complete",
      responseDueDate: new Date("2026-10-01T00:00:00Z"),
    });
    const rows = await getRecordsRequests(M, TZ);
    const by = Object.fromEntries(rows.map((r) => [r.subject, r]));
    expect(by.late.daysUntilDue).toBe(-3);
    expect(by.late.isOverdue).toBe(true);
    expect(by.soon.daysUntilDue).toBe(3);
    expect(by.soon.isOverdue).toBe(false);
    expect(by["done-late"].isOverdue).toBe(false);
    expect(by.late.typeName).toBe("Billing");
    expect(by.late.custodianName).toBe("St. Mary's");
    expect(by.late.ownerInitials).toBe("AB");
    expect(by.late.feeAmount).toBeNull();
  });

  test("only the scope's rows; counts letters and received records", async () => {
    const { leadId } = await seedLead();
    await prisma.recordsRequest.create({
      data: { leadId, custodianContactId: custodianId, adHocTypeName: "x", subject: "lead one" },
    });
    const r = await req({ feeAmount: "12.50" });
    for (const [i, role] of ["request_letter", "received_records", "received_records"].entries()) {
      const { documentId } = await seedDocument({ matterId, name: `d${i}` });
      await prisma.document.update({
        where: { id: documentId },
        data: { recordsRequestId: r.id, recordsRequestRole: role },
      });
    }
    const rows = await getRecordsRequests(M, TZ);
    expect(rows.map((x) => x.subject)).toEqual(["Bills"]);
    expect(rows[0].letterCount).toBe(1);
    expect(rows[0].recordsCount).toBe(2);
    expect(rows[0].feeAmount).toBe("12.50");
  });
});

describe("getRecordsRequestDetail", () => {
  test("a request outside the scope is null", async () => {
    const r = await req();
    const { leadId } = await seedLead();
    expect(await getRecordsRequestDetail({ kind: "lead", leadId }, r.id)).toBeNull();
    expect(await getRecordsRequestDetail(M, "nope")).toBeNull();
    expect((await getRecordsRequestDetail(M, r.id))?.id).toBe(r.id);
  });

  test("follow-ups newest first, expense lock follows invoice", async () => {
    const r = await req();
    for (const [i, d] of ["2026-10-01", "2026-10-10"].entries()) {
      await prisma.recordsRequestFollowUp.create({
        data: { requestId: r.id, userId, occurredAt: new Date(`${d}T00:00:00Z`), note: `n${i}` },
      });
    }
    const d = await getRecordsRequestDetail(M, r.id);
    expect(d?.followUps.map((f) => f.note)).toEqual(["n1", "n0"]);
    expect(d?.expenseLocked).toBe(false);
  });
});
