/**
 * Tests for the email-sync cron endpoint's auth gate.
 *
 * Mirrors the notification-sweep idiom: exact CRON_SECRET bearer or
 * 401, and an UNSET secret rejects everything (fail closed). The
 * sweep body is mocked — the sync engine has its own suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google/gmail-sync", () => ({
  syncAllEmailAccounts: vi.fn(),
}));

import { syncAllEmailAccounts } from "@/lib/google/gmail-sync";
import { GET } from "./route";

const mockedSync = vi.mocked(syncAllEmailAccounts);

const savedSecret = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  mockedSync.mockResolvedValue([
    {
      accountId: "acc1",
      emailAddress: "me@gmail.com",
      ok: true,
      mode: "full",
      threadsSynced: 3,
    },
  ]);
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

const request = (auth?: string): Request =>
  new Request("https://app.example/api/email-sync", {
    headers: auth ? { authorization: auth } : {},
  });

describe("GET /api/email-sync", () => {
  it("rejects everything when CRON_SECRET is unset (fail closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request("Bearer anything"));
    expect(res.status).toBe(401);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("runs the all-accounts sync on the exact bearer, summarizing results", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, accounts: 1, synced: 1 });
    // Account ids only — no email addresses in cron output.
    expect(JSON.stringify(body)).not.toContain("me@gmail.com");
    expect(mockedSync).toHaveBeenCalledOnce();
  });

  it("500s (without leaking the error) when the sweep itself throws", async () => {
    process.env.CRON_SECRET = "s3cret";
    mockedSync.mockRejectedValue(new Error("db down"));
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Sync failed" });
  });
});
