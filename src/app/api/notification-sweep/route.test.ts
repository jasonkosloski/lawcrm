// @vitest-environment node
//
// Node environment: happy-dom's Request drops forbidden headers
// (Authorization), same reason as proxy.test.ts.

/**
 * Tests for the notification-sweep cron endpoint's auth gate.
 *
 * The proxy exempts this path from the login gate
 * (SELF_AUTHENTICATED_PATHS), so the route's own CRON_SECRET bearer
 * check is the ONLY control: exact bearer or 401, and an unset or
 * empty secret rejects everything (fail closed). The sweep itself is
 * mocked - it has its own suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notification-sweeps", () => ({
  runDeadlineNotificationSweep: vi.fn(),
}));
vi.mock("@/lib/portal/prune", () => ({
  prunePortalRecords: vi.fn(),
}));

import { runDeadlineNotificationSweep } from "@/lib/notification-sweeps";
import { prunePortalRecords } from "@/lib/portal/prune";
import { GET } from "./route";

const mockedSweep = vi.mocked(runDeadlineNotificationSweep);
const mockedPrune = vi.mocked(prunePortalRecords);
const savedSecret = process.env.CRON_SECRET;

beforeEach(() => {
  mockedSweep.mockReset();
  mockedSweep.mockResolvedValue({ notified: 3 } as never);
  mockedPrune.mockReset();
  mockedPrune.mockResolvedValue({ sessions: 0, tokens: 0, linkRequests: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

const request = (auth?: string): Request =>
  new Request("https://app.example/api/notification-sweep", {
    headers: auth === undefined ? {} : { authorization: auth },
  });

describe("GET /api/notification-sweep", () => {
  it("rejects everything when CRON_SECRET is unset (fail closed)", async () => {
    delete process.env.CRON_SECRET;
    for (const auth of [undefined, "Bearer anything", "Bearer undefined", "Bearer "]) {
      const res = await GET(request(auth));
      expect(res.status).toBe(401);
    }
    expect(mockedSweep).not.toHaveBeenCalled();
    expect(mockedPrune).not.toHaveBeenCalled();
  });

  it("rejects everything when CRON_SECRET is the empty string", async () => {
    process.env.CRON_SECRET = "";
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect((await GET(request("Bearer"))).status).toBe(401);
    expect(mockedSweep).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    // Same length, one byte off; and longer / shorter than the secret.
    expect((await GET(request("Bearer s3creX"))).status).toBe(401);
    expect((await GET(request("Bearer s3cret-extra"))).status).toBe(401);
    expect((await GET(request("Bearer s3cre"))).status).toBe(401);
    // The secret without the scheme is not a bearer.
    expect((await GET(request("s3cret"))).status).toBe(401);
    expect(mockedSweep).not.toHaveBeenCalled();
  });

  it("runs the unthrottled sweep with revalidation on the exact bearer", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, notified: 3 });
    expect(mockedSweep).toHaveBeenCalledOnce();
    expect(mockedSweep.mock.calls[0][1]).toEqual({ revalidate: true });
    expect(mockedPrune).toHaveBeenCalledOnce();
    expect(mockedPrune.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  it("a portal prune failure is logged and never fails the sweep", async () => {
    process.env.CRON_SECRET = "s3cret";
    mockedPrune.mockRejectedValue(new Error("prune boom"));
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, notified: 3 });
    expect(mockedSweep).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      "[notification-sweep] portal prune failed",
      expect.any(Error)
    );
  });

  it("500s with a generic body (no error text) when the sweep throws", async () => {
    process.env.CRON_SECRET = "s3cret";
    mockedSweep.mockRejectedValue(new Error("connection string postgres://secret"));
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Sweep failed" });
    expect(JSON.stringify(body)).not.toContain("postgres");
  });
});
