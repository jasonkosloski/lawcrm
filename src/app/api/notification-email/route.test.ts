// @vitest-environment node
//
// Node environment: happy-dom's Request drops forbidden headers
// (Authorization), same reason as proxy.test.ts.

/**
 * Tests for the notification-email cron endpoint's auth gate. The
 * proxy exempts this path, so the CRON_SECRET bearer check is the only
 * control. The worker is mocked; it has its own integration suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notification-email", () => ({
  runNotificationEmailDelivery: vi.fn(),
}));

import { runNotificationEmailDelivery } from "@/lib/notification-email";
import { GET } from "./route";

const mockedRun = vi.mocked(runNotificationEmailDelivery);
const savedSecret = process.env.CRON_SECRET;
const counts = { sent: 2, skipped: 1, held: 0, failed: 0, digests: 1 };

const req = (auth?: string) =>
  new Request("https://app.example.com/api/notification-email", {
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  mockedRun.mockReset();
  mockedRun.mockResolvedValue(counts);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env.CRON_SECRET = savedSecret;
  vi.restoreAllMocks();
});

describe("GET /api/notification-email", () => {
  it("rejects without bearer", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer", async () => {
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("runs with bearer", async () => {
    const res = await GET(req("Bearer cron-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...counts });
  });

  it("worker throw returns 500 and logs", async () => {
    mockedRun.mockRejectedValue(new Error("db down"));
    const res = await GET(req("Bearer cron-secret"));
    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalled();
  });
});
