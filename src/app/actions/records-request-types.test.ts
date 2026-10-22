/**
 * Integration tests for the records request type settings actions.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(async () => "test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  createRecordsRequestType,
  moveRecordsRequestType,
  setRecordsRequestTypeActive,
  updateRecordsRequestType,
} from "@/app/actions/records-request-types";
import { listRecordsRequestTypes } from "@/lib/queries/records-requests";
import type { RecordsRequestFormState } from "@/lib/records-requests/form";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const IDLE: RecordsRequestFormState = { status: "idle" };
let userId: string;

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  const base = {
    name: "Employment records",
    responseAmount: "30",
    responseUnit: "CALENDAR_DAYS",
    followUpDays: "7",
    defaultTemplateId: "",
  };
  for (const [k, v] of Object.entries({ ...base, ...o })) f.set(k, v);
  return f;
}

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  const firm = await seedFirm();
  userId = (await seedUser({ firmId: firm.firmId })).userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);
});

describe("createRecordsRequestType", () => {
  test("creates a row, gated and logged", async () => {
    const res = await createRecordsRequestType(IDLE, fd({}));
    expect(res.status).toBe("ok");
    expect(requirePermission).toHaveBeenCalledWith("records.types.manage");
    const row = await prisma.recordsRequestType.findFirstOrThrow();
    expect(row).toMatchObject({
      name: "Employment records",
      responseAmount: 30,
      responseUnit: "CALENDAR_DAYS",
      followUpDays: 7,
      defaultTemplateId: null,
      isActive: true,
    });
    const log = await prisma.activityLog.findFirst({ where: { type: "records" } });
    expect(log?.matterId).toBeNull();
  });

  test("blank amount stores no period", async () => {
    await createRecordsRequestType(IDLE, fd({ responseAmount: "", responseUnit: "" }));
    const row = await prisma.recordsRequestType.findFirstOrThrow();
    expect(row.responseAmount).toBeNull();
    expect(row.responseUnit).toBeNull();
  });

  test("amount without unit errors on responseUnit", async () => {
    const res = await createRecordsRequestType(IDLE, fd({ responseUnit: "" }));
    expect(res.status).toBe("error");
    expect(res.errors?.responseUnit).toBeTruthy();
    expect(await prisma.recordsRequestType.count()).toBe(0);
  });

  test("range checks on amount and follow-up days", async () => {
    const res = await createRecordsRequestType(
      IDLE,
      fd({ responseAmount: "366", followUpDays: "0" }),
    );
    expect(res.errors?.responseAmount).toBeTruthy();
    expect(res.errors?.followUpDays).toBeTruthy();
  });

  test("duplicate active name (case-insensitive) errors on name", async () => {
    await createRecordsRequestType(IDLE, fd({}));
    const res = await createRecordsRequestType(IDLE, fd({ name: "employment RECORDS" }));
    expect(res.errors?.name).toBeTruthy();
    expect(await prisma.recordsRequestType.count()).toBe(1);
  });

  test("an archived name may be reused", async () => {
    await createRecordsRequestType(IDLE, fd({}));
    const old = await prisma.recordsRequestType.findFirstOrThrow();
    await setRecordsRequestTypeActive(old.id, false);
    const res = await createRecordsRequestType(IDLE, fd({}));
    expect(res.status).toBe("ok");
    // ...but then the old one can't be restored.
    const back = await setRecordsRequestTypeActive(old.id, true);
    expect(back.ok).toBe(false);
  });

  test("default template must be active", async () => {
    const t = await prisma.documentTemplate.create({
      data: { name: "T", category: "general", body: "x", isActive: false, createdById: userId },
    });
    const res = await createRecordsRequestType(IDLE, fd({ defaultTemplateId: t.id }));
    expect(res.errors?.defaultTemplateId).toBeTruthy();
    await prisma.documentTemplate.update({ where: { id: t.id }, data: { isActive: true } });
    const ok = await createRecordsRequestType(IDLE, fd({ defaultTemplateId: t.id }));
    expect(ok.status).toBe("ok");
  });
});

describe("update / archive / move", () => {
  test("update edits in place and allows keeping its own name", async () => {
    await createRecordsRequestType(IDLE, fd({}));
    const row = await prisma.recordsRequestType.findFirstOrThrow();
    const res = await updateRecordsRequestType(row.id, IDLE, fd({ followUpDays: "14" }));
    expect(res.status).toBe("ok");
    expect((await prisma.recordsRequestType.findFirstOrThrow()).followUpDays).toBe(14);
  });

  test("archive hides it from the active-only list", async () => {
    await createRecordsRequestType(IDLE, fd({}));
    const row = await prisma.recordsRequestType.findFirstOrThrow();
    await setRecordsRequestTypeActive(row.id, false);
    expect(await listRecordsRequestTypes({ activeOnly: true })).toEqual([]);
    expect(await listRecordsRequestTypes({ activeOnly: false })).toHaveLength(1);
  });

  test("move swaps order among active types", async () => {
    await createRecordsRequestType(IDLE, fd({ name: "A" }));
    await createRecordsRequestType(IDLE, fd({ name: "B" }));
    const b = await prisma.recordsRequestType.findFirstOrThrow({ where: { name: "B" } });
    await moveRecordsRequestType(b.id, "up");
    const names = (await listRecordsRequestTypes({ activeOnly: true })).map((r) => r.name);
    expect(names).toEqual(["B", "A"]);
  });
});
