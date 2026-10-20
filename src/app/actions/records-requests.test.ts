/**
 * Integration tests for the records-request actions: create / update /
 * status / delete, plus the rolling follow-up task they keep in step.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { setTaskStatus, updateTask } from "@/app/actions/tasks";
import { updateTaskInitialState } from "@/lib/task-form";

import { revalidatePath } from "next/cache";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "test-user"),
  assertOptionalMatterAccess: vi.fn(async () => "test-user"),
  assertChildMatterAccess: vi.fn(async () => null),
  canAccessMatter: vi.fn(async () => true),
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "test-user"),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { assertMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  createCustodianContact,
  createRecordsRequest,
  deleteRecordsRequest,
  linkRecordsDocuments,
  logRecordsFollowUp,
  markRecordsRequestSent,
  saveRecordsFee,
  setRecordsRequestStatus,
  unlinkRecordsDocument,
  updateRecordsRequest,
} from "@/app/actions/records-requests";
import { resolveRecordsRoleFolder } from "@/lib/records-requests/folder";
import { openFollowUpTask, rollFollowUp } from "@/lib/records-requests/follow-up";
import { SAME_SCOPE_ERROR, type RecordScope } from "@/lib/record-scope";
import type { RecordsRequestFormState } from "@/lib/records-requests/form";
import {
  resetDb,
  seedContact,
  seedDocumentFolder,
  seedDocument,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const IDLE: RecordsRequestFormState = { status: "idle" };

let userId: string;
let matterId: string;
let M: RecordScope;
let custodianId: string;
let typeId: string;

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

async function seedRequest(over: Record<string, unknown> = {}) {
  return prisma.recordsRequest.create({
    data: {
      matterId,
      custodianContactId: custodianId,
      typeId,
      subject: "Medical records",
      status: "sent",
      ownerId: userId,
      nextFollowUpDate: new Date("2026-10-25T00:00:00Z"),
      ...over,
    },
  });
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, name: "Test Attorney" });
  userId = u.userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);
  vi.mocked(assertMatterAccess).mockResolvedValue(userId);
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  const { areaId, stageId } = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Alvarez v. City",
  });
  matterId = m.matterId;
  M = { kind: "matter", matterId };
  custodianId = (await seedContact({ name: "Mercy Hospital" })).contactId;
  typeId = (
    await prisma.recordsRequestType.create({
      data: { name: "Medical records", followUpDays: 7 },
    })
  ).id;
});

describe("createRecordsRequest", () => {
  test("creates a draft on a matter, gated on records.create", async () => {
    const res = await createRecordsRequest(
      M,
      IDLE,
      fd({
        custodianContactId: custodianId,
        typeId,
        subject: "Chart 2024",
      })
    );
    expect(res.status).toBe("ok");
    expect(requirePermission).toHaveBeenCalledWith("records.create");
    const row = await prisma.recordsRequest.findFirstOrThrow();
    expect(row.matterId).toBe(matterId);
    expect(row.leadId).toBeNull();
    expect(row.status).toBe("draft");
    expect(row.ownerId).toBe(userId);
    expect(row.createdById).toBe(userId);
  });

  test("creates on a lead", async () => {
    const { leadId } = await seedLead();
    const res = await createRecordsRequest(
      { kind: "lead", leadId },
      IDLE,
      fd({ custodianContactId: custodianId, typeId, subject: "Chart" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.recordsRequest.findFirstOrThrow();
    expect(row.leadId).toBe(leadId);
    expect(row.matterId).toBeNull();
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { type: "records" },
    });
    expect(log.matterId).toBeNull();
  });

  test("ad hoc without a name is a field error", async () => {
    const res = await createRecordsRequest(
      M,
      IDLE,
      fd({ custodianContactId: custodianId, typeId: "", subject: "x" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.adHocTypeName).toBeDefined();
    expect(await prisma.recordsRequest.count()).toBe(0);
  });

  test("ad hoc with a name and manual due date saves", async () => {
    const res = await createRecordsRequest(
      M,
      IDLE,
      fd({
        custodianContactId: custodianId,
        typeId: "",
        adHocTypeName: "Body cam",
        subject: "Footage",
        responseDueDate: "2026-11-01",
      })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.recordsRequest.findFirstOrThrow();
    expect(row.typeId).toBeNull();
    expect(row.adHocTypeName).toBe("Body cam");
    expect(row.responseDueDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  test("refuses a converted lead", async () => {
    const { leadId } = await seedLead();
    await prisma.lead.update({ where: { id: leadId }, data: { stage: "converted" } });
    const res = await createRecordsRequest(
      { kind: "lead", leadId },
      IDLE,
      fd({ custodianContactId: custodianId, typeId, subject: "x" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/already converted/);
    expect(await prisma.recordsRequest.count()).toBe(0);
  });
});

describe("updateRecordsRequest", () => {
  const base = () => ({
    custodianContactId: custodianId,
    typeId,
    subject: "Medical records",
  });

  test("owner change re-assigns the open follow-up task", async () => {
    const other = await seedUser({
      firmId: (await prisma.firm.findFirstOrThrow()).id,
      name: "Other",
      email: "other@x.test",
    });
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const res = await updateRecordsRequest(
      r.id,
      IDLE,
      fd({ ...base(), ownerId: other.userId })
    );
    expect(res.status).toBe("ok");
    expect(requirePermission).toHaveBeenCalledWith("records.edit");
    const task = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    expect(task.ownerId).toBe(other.userId);
  });

  test("changing the type never recomputes responseDueDate", async () => {
    const t2 = await prisma.recordsRequestType.create({
      data: {
        name: "Police report",
        responseAmount: 3,
        responseUnit: "CALENDAR_DAYS",
      },
    });
    const r = await seedRequest({
      responseDueDate: new Date("2026-10-21T00:00:00Z"),
    });
    const res = await updateRecordsRequest(
      r.id,
      IDLE,
      fd({ ...base(), typeId: t2.id, responseDueDate: "2026-10-21" })
    );
    expect(res.status).toBe("ok");
    const after = await prisma.recordsRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(after.typeId).toBe(t2.id);
    expect(after.responseDueDate?.toISOString().slice(0, 10)).toBe(
      "2026-10-21"
    );
  });

  test("stale expectedUpdatedAt is a _form error", async () => {
    const r = await seedRequest();
    const res = await updateRecordsRequest(
      r.id,
      IDLE,
      fd({
        ...base(),
        expectedUpdatedAt: new Date(r.updatedAt.getTime() - 5000).toISOString(),
        subject: "Changed",
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form).toBeDefined();
    const after = await prisma.recordsRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(after.subject).toBe("Medical records");
  });
});

describe("setRecordsRequestStatus", () => {
  test("partial -> sent is refused", async () => {
    const r = await seedRequest({ status: "partial" });
    const res = await setRecordsRequestStatus(r.id, "sent");
    expect(res.ok).toBe(false);
  });

  test("draft -> sent must use Mark sent", async () => {
    const r = await seedRequest({ status: "draft" });
    const res = await setRecordsRequestStatus(r.id, "sent");
    expect(res).toEqual({ ok: false, error: "Use Mark sent to send a request." });
  });

  test("complete cancels the task, clears next follow-up, sets receivedAt", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const res = await setRecordsRequestStatus(r.id, "complete");
    expect(res.ok).toBe(true);
    const after = await prisma.recordsRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(after.status).toBe("complete");
    expect(after.nextFollowUpDate).toBeNull();
    expect(after.receivedAt).not.toBeNull();
    const task = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    expect(task.status).toBe("cancelled");
    expect(task.completedAt).not.toBeNull();
  });

  test("complete -> sent logs a reopen", async () => {
    const r = await seedRequest({ status: "complete", nextFollowUpDate: null, sentAt: new Date("2026-10-01T00:00:00Z") });
    const res = await setRecordsRequestStatus(r.id, "sent");
    expect(res.ok).toBe(true);
    const log = await prisma.activityLog.findFirst({
      where: { type: "records", title: "Records request reopened" },
    });
    expect(log).not.toBeNull();
  });
});

describe("draft and reopen constraints", () => {
  const SENT_AT = new Date("2026-10-01T00:00:00Z");

  test("a draft cannot skip to acknowledged / partial / complete", async () => {
    for (const to of ["acknowledged", "partial", "complete"] as const) {
      const r = await seedRequest({ status: "draft", nextFollowUpDate: null });
      const res = await setRecordsRequestStatus(r.id, to);
      expect(res).toEqual({ ok: false, error: "Use Mark sent to send a request." });
      expect(
        (await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } })).status
      ).toBe("draft");
    }
  });

  test("a draft can be withdrawn without any task", async () => {
    const r = await seedRequest({ status: "draft", nextFollowUpDate: null });
    const res = await setRecordsRequestStatus(r.id, "withdrawn");
    expect(res.ok).toBe(true);
    expect(await prisma.task.count({ where: { recordsRequestId: r.id } })).toBe(0);
  });

  test("openFollowUpTask and rollFollowUp do nothing for a draft", async () => {
    const r = await seedRequest({ status: "draft", nextFollowUpDate: null });
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    expect(await prisma.task.count({ where: { recordsRequestId: r.id } })).toBe(0);
    const rolled = await prisma.$transaction((tx) =>
      rollFollowUp(tx, r.id, { actorId: userId, note: null, today: "2026-10-18" })
    );
    expect(rolled).toBe(false);
    expect(await prisma.recordsRequestFollowUp.count()).toBe(0);
  });

  test("logRecordsFollowUp on a draft is refused", async () => {
    const r = await seedRequest({ status: "draft", nextFollowUpDate: null });
    const res = await logRecordsFollowUp(r.id, IDLE, fd({ note: "x" }));
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toBe("Send the request before logging follow-ups.");
    expect(await prisma.recordsRequestFollowUp.count()).toBe(0);
  });

  test("a never-sent terminal request reopens only to draft, with no task", async () => {
    const r = await seedRequest({ status: "withdrawn", nextFollowUpDate: null, sentAt: null });
    const bad = await setRecordsRequestStatus(r.id, "sent");
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
    const ok = await setRecordsRequestStatus(r.id, "draft");
    expect(ok.ok).toBe(true);
    const after = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("draft");
    expect(after.nextFollowUpDate).toBeNull();
    expect(await prisma.task.count({ where: { recordsRequestId: r.id } })).toBe(0);
  });

  test("a sent terminal request never reopens to draft", async () => {
    const r = await seedRequest({ status: "complete", nextFollowUpDate: null, sentAt: SENT_AT });
    const bad = await setRecordsRequestStatus(r.id, "draft");
    expect(bad.ok).toBe(false);
    const ok = await setRecordsRequestStatus(r.id, "partial");
    expect(ok.ok).toBe(true);
    expect(
      await prisma.task.count({ where: { recordsRequestId: r.id, status: "open" } })
    ).toBe(1);
  });

  test("markRecordsRequestSent re-dates an already-open follow-up task", async () => {
    const r = await seedRequest({ status: "draft", nextFollowUpDate: null });
    await prisma.task.create({
      data: {
        matterId,
        recordsRequestId: r.id,
        title: "Stray",
        dueDate: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await markRecordsRequestSent(r.id, IDLE, fd({ sentAt: "2026-10-16" }));
    const open = await prisma.task.findMany({
      where: { recordsRequestId: r.id, status: "open" },
    });
    expect(open).toHaveLength(1);
    expect(open[0].dueDate?.toISOString().slice(0, 10)).toBe("2026-10-23");
  });
});

describe("deleteRecordsRequest", () => {
  test("cancels the task and detaches documents, clearing their role", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const { documentId } = await seedDocument({ matterId });
    await prisma.document.update({
      where: { id: documentId },
      data: { recordsRequestId: r.id, recordsRequestRole: "received_records" },
    });
    const res = await deleteRecordsRequest(r.id);
    expect(res.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith("records.delete");
    expect(await prisma.recordsRequest.count()).toBe(0);
    const task = await prisma.task.findFirstOrThrow({});
    expect(task.status).toBe("cancelled");
    expect(task.recordsRequestId).toBeNull();
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(doc.recordsRequestId).toBeNull();
    expect(doc.recordsRequestRole).toBeNull();
  });

  test("generated folders are unprotected and keep their documents", async () => {
    const r = await seedRequest();
    const folderId = await prisma.$transaction((tx) =>
      resolveRecordsRoleFolder(
        tx,
        {
          id: r.id,
          matterId,
          leadId: null,
          custodianName: "Memorial Hospital",
          typeName: "CORA",
        },
        "received_records"
      )
    );
    const { documentId } = await seedDocument({ matterId, folderId });
    await deleteRecordsRequest(r.id);
    const folders = await prisma.documentFolder.findMany({ where: { matterId } });
    const linked = folders.filter((f) => f.name !== "Investigation" && f.name !== "Records Requests");
    expect(linked).toHaveLength(2);
    for (const f of linked) {
      expect(f.systemKind).toBeNull();
      expect(f.recordsRequestId).toBeNull();
    }
    expect(folders.find((f) => f.name === "Records Requests")?.systemKind).toBe("records_root");
    expect(await prisma.document.count({ where: { id: documentId } })).toBe(1);
  });

  test("never revalidates the request page being viewed", async () => {
    const r = await seedRequest();
    vi.mocked(revalidatePath).mockClear();
    await deleteRecordsRequest(r.id);
    const calls = vi.mocked(revalidatePath).mock.calls;
    expect(calls.map((c) => c[0])).toContain(`/matters/${matterId}/records`);
    expect(calls.some((c) => String(c[0]).includes("[requestId]"))).toBe(false);
  });
});

describe("rollFollowUp", () => {
  test("logs, completes the old task, schedules next chase and opens a new task", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const rolled = await prisma.$transaction((tx) =>
      rollFollowUp(tx, r.id, { actorId: userId, note: "Called", today: "2026-10-18" })
    );
    expect(rolled).toBe(true);
    const after = await prisma.recordsRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(after.nextFollowUpDate?.toISOString().slice(0, 10)).toBe("2026-10-25");
    const tasks = await prisma.task.findMany({
      where: { recordsRequestId: r.id },
      orderBy: { createdAt: "asc" },
    });
    expect(tasks.map((t) => t.status)).toEqual(["done", "open"]);
    expect(tasks[1].title).toBe("Follow up: Mercy Hospital — Medical records");
    expect(await prisma.recordsRequestFollowUp.count()).toBe(1);
  });

  test("no-op on a closed request", async () => {
    const r = await seedRequest({ status: "complete" });
    const rolled = await prisma.$transaction((tx) =>
      rollFollowUp(tx, r.id, { actorId: userId, note: null, today: "2026-10-18" })
    );
    expect(rolled).toBe(false);
    expect(await prisma.recordsRequestFollowUp.count()).toBe(0);
  });
});

describe("concurrency and reopen", () => {
  test("concurrent openFollowUpTask yields one open task", async () => {
    const r = await seedRequest();
    await Promise.all([
      prisma.$transaction((tx) => openFollowUpTask(tx, r.id)),
      prisma.$transaction((tx) => openFollowUpTask(tx, r.id)),
    ]);
    expect(
      await prisma.task.count({
        where: { recordsRequestId: r.id, status: "open" },
      })
    ).toBe(1);
  });

  test("concurrent reopen: one wins, one open task", async () => {
    const r = await seedRequest({ status: "complete", nextFollowUpDate: null, sentAt: new Date("2026-10-01T00:00:00Z") });
    const res = await Promise.all([
      setRecordsRequestStatus(r.id, "sent"),
      setRecordsRequestStatus(r.id, "sent"),
    ]);
    expect(res.filter((x) => x.ok)).toHaveLength(1);
    expect(res.filter((x) => !x.ok)).toHaveLength(1);
    expect(
      await prisma.task.count({
        where: { recordsRequestId: r.id, status: "open" },
      })
    ).toBe(1);
  });

  test("reopen restarts the chase at today + interval", async () => {
    const r = await seedRequest({ status: "complete", nextFollowUpDate: null, sentAt: new Date("2026-10-01T00:00:00Z") });
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Denver",
    });
    const expected = new Date(
      Date.parse(`${today}T00:00:00Z`) + 7 * 86400000
    );
    await setRecordsRequestStatus(r.id, "sent");
    const after = await prisma.recordsRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(after.nextFollowUpDate?.getTime()).toBe(expected.getTime());
    const task = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id, status: "open" },
    });
    expect(task.dueDate?.getTime()).toBe(expected.getTime());
  });
});

describe("markRecordsRequestSent", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("computes due date from the type period and opens one follow-up task", async () => {
    const cora = await prisma.recordsRequestType.create({
      data: {
        name: "CORA",
        followUpDays: 7,
        responseAmount: 3,
        responseUnit: "BUSINESS_DAYS",
      },
    });
    const r = await seedRequest({
      typeId: cora.id,
      status: "draft",
      nextFollowUpDate: null,
    });
    const res = await markRecordsRequestSent(
      r.id,
      IDLE,
      fd({ sentAt: "2026-10-16" })
    );
    expect(res.status).toBe("ok");
    expect(requirePermission).toHaveBeenCalledWith("records.edit");
    const after = await prisma.recordsRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(after.status).toBe("sent");
    expect(after.responseDueDate?.toISOString().slice(0, 10)).toBe("2026-10-21");
    expect(after.nextFollowUpDate?.toISOString().slice(0, 10)).toBe(
      "2026-10-23"
    );
    const tasks = await prisma.task.findMany({
      where: { recordsRequestId: r.id, status: "open" },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Follow up: Mercy Hospital — CORA");
    expect(tasks[0].ownerId).toBe(userId);
  });

  test("ad hoc with no due date leaves responseDueDate null", async () => {
    const r = await seedRequest({
      typeId: null,
      adHocTypeName: "Police report",
      status: "draft",
      nextFollowUpDate: null,
    });
    await markRecordsRequestSent(r.id, IDLE, fd({ sentAt: "2026-10-16" }));
    const after = await prisma.recordsRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(after.responseDueDate).toBeNull();
    expect(after.nextFollowUpDate?.toISOString().slice(0, 10)).toBe(
      "2026-10-23"
    );
  });

  test("rejects a request that is not a draft", async () => {
    const r = await seedRequest({ status: "sent" });
    const res = await markRecordsRequestSent(r.id, IDLE, fd({}));
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/draft/i);
  });
});

describe("logRecordsFollowUp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("logs, closes the old task and opens one new task a week out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T18:00:00Z"));
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const old = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    const res = await logRecordsFollowUp(r.id, IDLE, fd({ note: "Called" }));
    expect(res.status).toBe("ok");
    expect(await prisma.recordsRequestFollowUp.count()).toBe(1);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: old.id } })).status
    ).toBe("done");
    const open = await prisma.task.findMany({
      where: { recordsRequestId: r.id, status: "open" },
    });
    expect(open).toHaveLength(1);
    expect(open[0].dueDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
  });
});

describe("task completion hook", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("setTaskStatus done on the follow-up task rolls it", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const old = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    await setTaskStatus(old.id, "done");
    expect(await prisma.recordsRequestFollowUp.count()).toBe(1);
    const open = await prisma.task.findMany({
      where: { recordsRequestId: r.id, status: "open" },
    });
    expect(open).toHaveLength(1);
    expect(open[0].id).not.toBe(old.id);
  });

  test("reopening a cancelled follow-up on a closed request is refused", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    await setRecordsRequestStatus(r.id, "complete");
    const t = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    expect(t.status).toBe("cancelled");
    const res = await setTaskStatus(t.id, "open");
    expect(res).toEqual({
      ok: false,
      error: "This records request is closed \u2014 reopen the request first.",
    });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status
    ).toBe("cancelled");
    expect(await prisma.recordsRequestFollowUp.count()).toBe(0);
  });

  test("reopening a rolled follow-up while the new one is open is refused", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const t = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    await setTaskStatus(t.id, "done");
    const openCount = () =>
      prisma.task.count({
        where: { recordsRequestId: r.id, status: { in: ["open", "in_progress"] } },
      });
    expect(await openCount()).toBe(1); // middle state: the rolled task
    const res = await setTaskStatus(t.id, "open");
    expect(res).toEqual({
      ok: false,
      error:
        "This follow-up was already rescheduled \u2014 use the open follow-up task instead.",
    });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status
    ).toBe("done");
    expect(await openCount()).toBe(1);
    expect(await prisma.recordsRequestFollowUp.count()).toBe(1);
  });

  test("updateTask refuses the same reopen with the same text", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const t = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    await setTaskStatus(t.id, "done");
    const res = await updateTask(
      t.id,
      updateTaskInitialState,
      fd({ title: t.title, priority: "normal", status: "open" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toBe(
      "This follow-up was already rescheduled \u2014 use the open follow-up task instead."
    );
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status
    ).toBe("done");
  });

  test("a follow-up cancelled by hand can be reopened when none is open", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const t = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    await setTaskStatus(t.id, "cancelled");
    const res = await setTaskStatus(t.id, "open");
    expect(res.ok).toBe(true);
    expect(
      await prisma.task.count({ where: { recordsRequestId: r.id, status: "open" } })
    ).toBe(1);
  });

  test("a concurrent task done and logged follow-up both finish with one open task", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const t = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    const results = await Promise.allSettled([
      setTaskStatus(t.id, "done"),
      logRecordsFollowUp(r.id, IDLE, fd({ note: "Called" })),
    ]);
    expect(results.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(
      await prisma.task.count({
        where: { recordsRequestId: r.id, status: { in: ["open", "in_progress"] } },
      })
    ).toBe(1);
  });

  test("two concurrent done calls roll only once", async () => {
    const r = await seedRequest();
    await prisma.$transaction((tx) => openFollowUpTask(tx, r.id));
    const t = await prisma.task.findFirstOrThrow({
      where: { recordsRequestId: r.id },
    });
    await Promise.all([setTaskStatus(t.id, "done"), setTaskStatus(t.id, "done")]);
    expect(await prisma.recordsRequestFollowUp.count()).toBe(1);
    expect(
      await prisma.task.count({
        where: { recordsRequestId: r.id, status: "open" },
      })
    ).toBe(1);
  });
});

describe("saveRecordsFee", () => {
  async function feeRequest() {
    const c = (await seedContact({ name: "Memorial Hospital" })).contactId;
    const t = await prisma.recordsRequestType.create({
      data: { name: "Medical (HIPAA)", followUpDays: 7 },
    });
    return seedRequest({ custodianContactId: c, typeId: t.id });
  }
  const fee = (o: Record<string, string>) => fd(o);

  test("matter fee with amount + paid date creates a billable Expense", async () => {
    const r = await feeRequest();
    const res = await saveRecordsFee(
      r.id,
      IDLE,
      fee({ feeEstimate: "40", feeAmount: "25.00", feePaidAt: "2026-10-20" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.recordsRequest.findUniqueOrThrow({
      where: { id: r.id },
      include: { expense: true },
    });
    expect(row.expenseId).not.toBeNull();
    expect(row.expense).toMatchObject({
      matterId,
      category: "records",
      billable: true,
      description: "Records \u2014 Memorial Hospital (Medical (HIPAA))",
    });
    expect(row.expense!.amount.toString()).toBe("25");
    expect(row.expense!.date.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(row.feeEstimate!.toString()).toBe("40");
  });

  test("editing the amount updates the same Expense", async () => {
    const r = await feeRequest();
    const f = { feeAmount: "25.00", feePaidAt: "2026-10-20" };
    await saveRecordsFee(r.id, IDLE, fee(f));
    const first = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    await saveRecordsFee(r.id, IDLE, fee({ ...f, feeAmount: "30.00" }));
    const after = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.expenseId).toBe(first.expenseId);
    expect(await prisma.expense.count()).toBe(1);
    const e = await prisma.expense.findUniqueOrThrow({ where: { id: after.expenseId! } });
    expect(e.amount.toString()).toBe("30");
  });

  test("an invoiced Expense is not changed", async () => {
    const r = await feeRequest();
    const f = { feeAmount: "25.00", feePaidAt: "2026-10-20" };
    await saveRecordsFee(r.id, IDLE, fee(f));
    const cur = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    const inv = await prisma.invoice.create({
      data: {
        matterId,
        invoiceNumber: "INV-T5",
        issueDate: new Date("2026-10-21T00:00:00Z"),
        dueDate: new Date("2026-11-21T00:00:00Z"),
      } as never,
    });
    await prisma.expense.update({
      where: { id: cur.expenseId! },
      data: { invoiceId: inv.id },
    });
    const res = await saveRecordsFee(r.id, IDLE, fee({ ...f, feeAmount: "30.00" }));
    expect(res.errors?._form?.[0]).toBe(
      "This fee is on an invoice and can't be changed."
    );
    const e = await prisma.expense.findUniqueOrThrow({ where: { id: cur.expenseId! } });
    expect(e.amount.toString()).toBe("25");
    const after = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.feeAmount!.toString()).toBe("25");
  });

  test("a lead fee is stored without an Expense or expense permission", async () => {
    const { leadId } = await seedLead();
    const r = await seedRequest({ matterId: null, leadId });
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    const res = await saveRecordsFee(
      r.id,
      IDLE,
      fee({ feeAmount: "25", feePaidAt: "2026-10-20" })
    );
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    expect(res.status).toBe("ok");
    const row = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.expenseId).toBeNull();
    expect(row.feeAmount!.toString()).toBe("25");
    expect(await prisma.expense.count()).toBe(0);
    // The log row carries the lead so the lead wall filters it (ADR-049).
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Records fee updated" },
    });
    expect(log.leadId).toBe(leadId);
  });

  test("a matter fee needs matters.expense.view", async () => {
    const r = await feeRequest();
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "matters.expense.view"
    );
    const res = await saveRecordsFee(
      r.id,
      IDLE,
      fee({ feeEstimate: "10" })
    );
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    expect(res.errors?._form?.[0]).toBe("You don't have permission to view expenses.");
    const row = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.feeEstimate).toBeNull();
  });

  test("missing matters.expense.create saves nothing", async () => {
    const r = await feeRequest();
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "matters.expense.create"
    );
    const res = await saveRecordsFee(
      r.id,
      IDLE,
      fee({ feeAmount: "25", feePaidAt: "2026-10-20" })
    );
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    expect(res.errors?._form?.[0]).toBe("You don't have permission to add expenses.");
    const row = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.feeAmount).toBeNull();
    expect(await prisma.expense.count()).toBe(0);
  });

  test("validates amounts and requires an amount for a paid date", async () => {
    const r = await feeRequest();
    const bad = await saveRecordsFee(r.id, IDLE, fee({ feeAmount: "-1" }));
    expect(bad.errors?.feeAmount).toBeDefined();
    const dec = await saveRecordsFee(r.id, IDLE, fee({ feeEstimate: "1.234" }));
    expect(dec.errors?.feeEstimate).toBeDefined();
    const paid = await saveRecordsFee(r.id, IDLE, fee({ feePaidAt: "2026-10-20" }));
    expect(paid.errors?.feePaidAt).toBeDefined();
  });

  const CLEAR_MSG =
    "This fee is recorded as an expense on the matter \u2014 edit or delete it on the Time & expenses tab.";

  test("clearing the fee while an Expense is linked is refused", async () => {
    const r = await feeRequest();
    await saveRecordsFee(r.id, IDLE, fee({ feeAmount: "25", feePaidAt: "2026-10-20" }));
    for (const f of [{ feeAmount: "25" }, {}] as Record<string, string>[]) {
      const res = await saveRecordsFee(r.id, IDLE, fee(f));
      expect(res.errors?._form?.[0]).toBe(CLEAR_MSG);
    }
    const row = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.feeAmount!.toString()).toBe("25");
    expect(row.feePaidAt).not.toBeNull();
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: row.expenseId! } })).amount.toString()).toBe("25");
  });

  test("invoiced Expense with cleared fields is refused unchanged", async () => {
    const r = await feeRequest();
    await saveRecordsFee(r.id, IDLE, fee({ feeAmount: "25", feePaidAt: "2026-10-20" }));
    const cur = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    const inv = await prisma.invoice.create({
      data: {
        matterId,
        invoiceNumber: "INV-T5B",
        issueDate: new Date("2026-10-21T00:00:00Z"),
        dueDate: new Date("2026-11-21T00:00:00Z"),
      } as never,
    });
    await prisma.expense.update({ where: { id: cur.expenseId! }, data: { invoiceId: inv.id } });
    const res = await saveRecordsFee(r.id, IDLE, fee({}));
    expect(res.status).toBe("error");
    const after = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.feeAmount!.toString()).toBe("25");
  });

  test("estimate-only change needs no expense.edit permission", async () => {
    const r = await feeRequest();
    const f = { feeAmount: "25", feePaidAt: "2026-10-20" };
    await saveRecordsFee(r.id, IDLE, fee(f));
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "matters.expense.edit"
    );
    const res = await saveRecordsFee(r.id, IDLE, fee({ ...f, feeEstimate: "50" }));
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    expect(res.status).toBe("ok");
    const row = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.feeEstimate!.toString()).toBe("50");
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: row.expenseId! } })).amount.toString()).toBe("25");
  });

  test("a zero fee never creates an Expense", async () => {
    const r = await feeRequest();
    const res = await saveRecordsFee(r.id, IDLE, fee({ feeAmount: "0", feePaidAt: "2026-10-20" }));
    expect(res.status).toBe("ok");
    const row = await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.expenseId).toBeNull();
    expect(row.feeAmount!.toString()).toBe("0");
    expect(row.feePaidAt).not.toBeNull();
    expect(await prisma.expense.count()).toBe(0);
  });
});

describe("linkRecordsDocuments / unlinkRecordsDocument", () => {
  test("links same-scope documents as received_records, gated on records.edit", async () => {
    const r = await seedRequest();
    const { documentId } = await seedDocument({ matterId });
    const res = await linkRecordsDocuments(r.id, [documentId], "received_records");
    expect(res).toEqual({ ok: true });
    expect(requirePermission).toHaveBeenCalledWith("records.edit");
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.recordsRequestId).toBe(r.id);
    expect(doc.recordsRequestRole).toBe("received_records");
  });

  test("a lead document cannot be linked to a matter request", async () => {
    const r = await seedRequest();
    const { leadId } = await seedLead();
    const leadDoc = await prisma.document.create({
      data: { leadId, name: "x.pdf", category: "other", source: "upload" },
      select: { id: true },
    });
    const res = await linkRecordsDocuments(r.id, [leadDoc.id], "received_records");
    expect(res).toEqual({ ok: false, error: SAME_SCOPE_ERROR });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: leadDoc.id } });
    expect(doc.recordsRequestId).toBeNull();
  });

  test("a missing document id refuses the whole batch", async () => {
    const r = await seedRequest();
    const { documentId } = await seedDocument({ matterId });
    const res = await linkRecordsDocuments(r.id, [documentId, "nope"], "received_records");
    expect(res.ok).toBe(false);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.recordsRequestId).toBeNull();
  });

  test("links with the request_letter role", async () => {
    const r = await seedRequest();
    const { documentId } = await seedDocument({ matterId });
    expect(await linkRecordsDocuments(r.id, [documentId], "request_letter")).toEqual({
      ok: true,
    });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.recordsRequestId).toBe(r.id);
    expect(doc.recordsRequestRole).toBe("request_letter");
  });

  test("re-linking a document on this request with the other role switches the role, without moving it", async () => {
    const r = await seedRequest();
    const { folderId } = await seedDocumentFolder({ matterId, name: "Somewhere" });
    const { documentId } = await seedDocument({ matterId, folderId });
    await prisma.document.update({
      where: { id: documentId },
      data: { recordsRequestId: r.id, recordsRequestRole: "request_letter" },
    });
    expect(await linkRecordsDocuments(r.id, [documentId], "received_records")).toEqual({
      ok: true,
    });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.recordsRequestRole).toBe("received_records");
    expect(doc.folderId).toBe(folderId);
  });

  test("an invalid role is refused and nothing is tagged", async () => {
    const r = await seedRequest();
    const { documentId } = await seedDocument({ matterId });
    const res = await linkRecordsDocuments(
      r.id,
      [documentId],
      "bogus" as unknown as "request_letter"
    );
    expect(res).toEqual({ ok: false, error: "Invalid records document kind." });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.recordsRequestId).toBeNull();
  });

  test("a document already linked to another request refuses the whole batch", async () => {
    const r = await seedRequest();
    const other = await seedRequest({ subject: "Other" });
    const a = await seedDocument({ matterId });
    const b = await seedDocument({ matterId });
    await prisma.document.update({
      where: { id: b.documentId },
      data: { recordsRequestId: other.id, recordsRequestRole: "received_records" },
    });
    const res = await linkRecordsDocuments(r.id, [a.documentId, b.documentId], "received_records");
    expect(res).toEqual({
      ok: false,
      error: "Some documents are already linked to another request.",
    });
    const da = await prisma.document.findUniqueOrThrow({ where: { id: a.documentId } });
    const db = await prisma.document.findUniqueOrThrow({ where: { id: b.documentId } });
    expect(da.recordsRequestId).toBeNull();
    expect(db.recordsRequestId).toBe(other.id);
  });

  test("unlink clears both columns and keeps the document", async () => {
    const r = await seedRequest();
    const { documentId } = await seedDocument({ matterId });
    await linkRecordsDocuments(r.id, [documentId], "received_records");
    const res = await unlinkRecordsDocument(documentId);
    expect(res).toEqual({ ok: true });
    expect(requirePermission).toHaveBeenCalledWith("records.edit");
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.recordsRequestId).toBeNull();
    expect(doc.recordsRequestRole).toBeNull();
  });
});

describe("createCustodianContact", () => {
  test("creates a medical_provider or government contact without redirecting", async () => {
    const a = await createCustodianContact("  Mercy Hospital ", "medical_provider");
    expect(a).toMatchObject({ ok: true, name: "Mercy Hospital" });
    const b = await createCustodianContact("City PD", "government");
    expect(b.ok).toBe(true);
    if (a.ok) {
      const row = await prisma.contact.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.type).toBe("medical_provider");
    }
    expect(requirePermission).toHaveBeenCalledWith("records.create");
    expect(requirePermission).toHaveBeenCalledWith("contacts.create");
  });

  test("rejects other types and blank names", async () => {
    expect((await createCustodianContact("X", "client")).ok).toBe(false);
    expect((await createCustodianContact("   ", "government")).ok).toBe(false);
  });
});
