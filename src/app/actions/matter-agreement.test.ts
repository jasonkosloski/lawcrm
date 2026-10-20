/**
 * Integration tests for updateMatterAgreement: upsert, document must
 * belong to the matter, and the firm "require signed originating
 * document" gate applied to the saved result.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "test-user"),
}));

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { updateMatterAgreement } from "@/app/actions/matter-agreement";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const idle = { status: "idle" as const };
let firmId: string;
let userId: string;
let matterId: string;
let otherMatterId: string;

function form(v: Record<string, string>) {
  const fd = new FormData();
  for (const [k, val] of Object.entries(v)) fd.set(k, val);
  return fd;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  userId = (await seedUser({ firmId })).userId;
  vi.mocked(requirePermission).mockReset();
  vi.mocked(requirePermission).mockResolvedValue(userId);
  const { areaId, stageId } = await seedPracticeArea();
  matterId = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId })).matterId;
  otherMatterId = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId })).matterId;
});

describe("updateMatterAgreement", () => {
  test("upserts when no row exists and logs old -> new", async () => {
    const { documentId } = await seedDocument({ matterId });
    const r = await updateMatterAgreement(
      matterId,
      idle,
      form({ status: "signed", signedDate: "2020-01-02", documentId })
    );
    expect(r.status).toBe("ok");
    const row = await prisma.matterAgreement.findUniqueOrThrow({ where: { matterId } });
    expect(row.status).toBe("signed");
    expect(row.documentId).toBe(documentId);
    const log = await prisma.activityLog.findFirst({ where: { matterId, type: "document" } });
    expect(log?.detail).toContain("Not sent → Signed");
  });

  test("rejects a document from another matter", async () => {
    const { documentId } = await seedDocument({ matterId: otherMatterId });
    const r = await updateMatterAgreement(matterId, idle, form({ status: "sent", documentId }));
    expect(r.status).toBe("error");
    expect(r.errors?.documentId).toBeDefined();
    expect(await prisma.matterAgreement.count({ where: { matterId } })).toBe(0);
  });

  test("switch on: clearing the signed date is an error", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { requireOriginatingDoc: true } });
    const { documentId } = await seedDocument({ matterId });
    const r = await updateMatterAgreement(
      matterId,
      idle,
      form({ status: "signed", signedDate: "", documentId })
    );
    expect(r.status).toBe("error");
    expect(r.errors?.agreementSignedDate).toEqual(["Enter the date it was signed."]);
  });

  test("switch on: unlinking the document is an error on documentId", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { requireOriginatingDoc: true } });
    const r = await updateMatterAgreement(
      matterId,
      idle,
      form({ status: "signed", signedDate: "2020-01-02", documentId: "" })
    );
    expect(r.errors?.documentId).toEqual(["Attach the signed Fee agreement."]);
  });

  test("switch off: unlink is allowed", async () => {
    const { documentId } = await seedDocument({ matterId });
    await updateMatterAgreement(matterId, idle, form({ status: "sent", documentId }));
    const r = await updateMatterAgreement(matterId, idle, form({ status: "sent", documentId: "" }));
    expect(r.status).toBe("ok");
    const row = await prisma.matterAgreement.findUniqueOrThrow({ where: { matterId } });
    expect(row.documentId).toBeNull();
  });
});
