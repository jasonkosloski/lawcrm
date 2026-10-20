// @vitest-environment node

/**
 * Clerk webhook -> audit trail. The proxy exempts this path
 * (SELF_AUTHENTICATED_PATHS), so the signature check is the only
 * control. verifyWebhook is mocked; prisma is a small in-memory fake.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: Array<Record<string, unknown>> = [];
const users = [{ id: "u1", clerkUserId: "user_known" }];

vi.mock("@clerk/nextjs/webhooks", () => ({ verifyWebhook: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(
        async ({ where }: { where: { clerkUserId: string } }) =>
          users.find((u) => u.clerkUserId === where.clerkUserId) ?? null
      ),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    activityLog: {
      findFirst: vi.fn(
        async ({ where }: { where: { title: string; detail: string } }) =>
          rows.find(
            (r) => r.title === where.title && r.detail === where.detail
          ) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rows.push(data);
        return data;
      }),
    },
  },
}));

import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const mockedVerify = vi.mocked(verifyWebhook);
const req = () =>
  new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    body: "{}",
  }) as never;
const event = (type: string, userId = "user_known", id = "sess_1") =>
  ({ type, data: { id, user_id: userId } }) as never;

beforeEach(() => {
  rows.length = 0;
  mockedVerify.mockReset();
  vi.mocked(prisma.user.update).mockClear();
  vi.mocked(prisma.user.updateMany).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/webhooks/clerk", () => {
  it("rejects a bad signature with 401 and writes nothing", async () => {
    mockedVerify.mockRejectedValue(new Error("bad sig"));
    expect((await POST(req())).status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it("session.created for a linked user writes one Signed in row", async () => {
    mockedVerify.mockResolvedValue(event("session.created"));
    expect((await POST(req())).status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "u1",
      type: "auth",
      title: "Signed in",
      detail: "Session sess_1",
    });
  });

  it("the same delivery twice still yields one row", async () => {
    mockedVerify.mockResolvedValue(event("session.created"));
    await POST(req());
    await POST(req());
    expect(rows).toHaveLength(1);
  });

  it("unknown user_id records a row with null userId", async () => {
    mockedVerify.mockResolvedValue(event("session.ended", "user_nobody"));
    expect((await POST(req())).status).toBe(200);
    expect(rows[0]).toMatchObject({ userId: null, title: "Signed out" });
  });

  it("maps removed -> Signed out and revoked -> Session revoked", async () => {
    mockedVerify.mockResolvedValue(event("session.removed", "user_known", "a"));
    await POST(req());
    mockedVerify.mockResolvedValue(event("session.revoked", "user_known", "b"));
    await POST(req());
    expect(rows.map((r) => r.title)).toEqual(["Signed out", "Session revoked"]);
  });

  it("other event types are a 200 no-op", async () => {
    mockedVerify.mockResolvedValue(event("user.updated"));
    expect((await POST(req())).status).toBe(200);
    expect(rows).toHaveLength(0);
  });

  it("never mutates User", async () => {
    mockedVerify.mockResolvedValue(event("session.created"));
    await POST(req());
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
