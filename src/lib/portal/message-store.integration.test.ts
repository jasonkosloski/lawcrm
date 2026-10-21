import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import {
  PORTAL_MESSAGE_MAX,
  advanceReadState,
  parseMessageBody,
  recordPortalMessage,
} from "./message-store";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

describe("parseMessageBody", () => {
  test("rejects empty and whitespace", () => {
    expect(parseMessageBody("").ok).toBe(false);
    expect(parseMessageBody("   \n ").ok).toBe(false);
    expect(parseMessageBody(undefined).ok).toBe(false);
  });
  test("accepts max length, rejects one over", () => {
    expect(parseMessageBody("a".repeat(PORTAL_MESSAGE_MAX)).ok).toBe(true);
    expect(parseMessageBody("a".repeat(PORTAL_MESSAGE_MAX + 1)).ok).toBe(false);
  });
  test("trims", () => {
    expect(parseMessageBody("  hi  ")).toEqual({ ok: true, body: "hi" });
  });
});

let matterId: string;
let userId: string;
let identityId: string;

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  const { contactId } = await seedContact({ email: "jane@example.com" });
  identityId = (await prisma.portalIdentity.create({ data: { contactId, email: "jane@example.com" } })).id;
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name: "M" }));
});

const T1 = new Date("2026-03-01T10:00:00Z");
const T2 = new Date("2026-03-01T11:00:00Z");
const T3 = new Date("2026-03-01T12:00:00Z");

describe("recordPortalMessage", () => {
  test("first message creates the thread", async () => {
    const r = await recordPortalMessage(matterId, "hello", { kind: "client", identityId }, T1);
    const thread = await prisma.portalThread.findUniqueOrThrow({ where: { matterId } });
    expect(thread.id).toBe(r.threadId);
    expect(thread.lastMessageAt).toEqual(T1);
    expect(thread.lastFromClient).toBe(true);
    const m = await prisma.portalMessage.findUniqueOrThrow({ where: { id: r.messageId } });
    expect(m).toMatchObject({ body: "hello", authorKind: "client", authorIdentityId: identityId, authorUserId: null });
  });

  test("client sets lastFromClient true, staff sets false", async () => {
    await recordPortalMessage(matterId, "a", { kind: "client", identityId }, T1);
    await recordPortalMessage(matterId, "b", { kind: "staff", userId }, T2);
    let t = await prisma.portalThread.findUniqueOrThrow({ where: { matterId } });
    expect(t.lastFromClient).toBe(false);
    expect(t.lastMessageAt).toEqual(T2);
    await recordPortalMessage(matterId, "c", { kind: "client", identityId }, T3);
    t = await prisma.portalThread.findUniqueOrThrow({ where: { matterId } });
    expect(t.lastFromClient).toBe(true);
    expect(t.lastMessageAt).toEqual(T3);
  });

  test("an older-timestamped message does not regress the thread", async () => {
    await recordPortalMessage(matterId, "late", { kind: "client", identityId }, T2);
    await recordPortalMessage(matterId, "early", { kind: "staff", userId }, T1);
    const t = await prisma.portalThread.findUniqueOrThrow({ where: { matterId } });
    expect(t.lastMessageAt).toEqual(T2);
    expect(t.lastFromClient).toBe(true);
    expect(await prisma.portalMessage.count()).toBe(2);
  });

  test("concurrent sends both persist on one thread", async () => {
    await Promise.all([
      recordPortalMessage(matterId, "one", { kind: "client", identityId }),
      recordPortalMessage(matterId, "two", { kind: "staff", userId }),
    ]);
    expect(await prisma.portalThread.count()).toBe(1);
    expect(await prisma.portalMessage.count()).toBe(2);
  });

  test("concurrent sends by the same sender both persist", async () => {
    await Promise.all([
      recordPortalMessage(matterId, "one", { kind: "client", identityId }),
      recordPortalMessage(matterId, "two", { kind: "client", identityId }),
    ]);
    expect(await prisma.portalMessage.count()).toBe(2);
    expect(await prisma.portalReadState.count()).toBe(1);
  });

  test("advances the sender's read state", async () => {
    const r = await recordPortalMessage(matterId, "hi", { kind: "client", identityId }, T1);
    const c = await prisma.portalReadState.findFirstOrThrow({ where: { threadId: r.threadId, identityId } });
    expect(c.lastReadAt).toEqual(T1);
    await recordPortalMessage(matterId, "yo", { kind: "staff", userId }, T2);
    const s = await prisma.portalReadState.findFirstOrThrow({ where: { threadId: r.threadId, userId } });
    expect(s.lastReadAt).toEqual(T2);
  });
});

describe("advanceReadState", () => {
  test("moves forward only", async () => {
    const r = await recordPortalMessage(matterId, "hi", { kind: "client", identityId }, T1);
    await advanceReadState(r.threadId, { userId }, T2);
    await advanceReadState(r.threadId, { userId }, T1);
    const s = await prisma.portalReadState.findFirstOrThrow({ where: { threadId: r.threadId, userId } });
    expect(s.lastReadAt).toEqual(T2);
  });
});
