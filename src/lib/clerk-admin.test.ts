import { beforeEach, describe, expect, it, vi } from "vitest";

const client = {
  invitations: { createInvitation: vi.fn() },
  users: { banUser: vi.fn(), unbanUser: vi.fn() },
  sessions: {
    getSessionList: vi.fn(),
    getSession: vi.fn(),
    revokeSession: vi.fn(),
  },
};
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => client),
}));

import {
  banStaff,
  inviteStaff,
  listActiveStaffSessions,
  revokeStaffSession,
  unbanStaff,
} from "./clerk-admin";

const FAIL = { ok: false, error: "Couldn't reach the sign-in service." };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("STAFF_ORIGINS", "https://crm.example.com");
});

function sess(id: string) {
  return { id, userId: "u1" };
}

describe("banStaff", () => {
  it("bans, then revokes every active session across pages", async () => {
    const order: string[] = [];
    client.users.banUser.mockImplementation(async () => void order.push("ban"));
    const first = Array.from({ length: 100 }, (_, i) => sess(`s${i}`));
    client.sessions.getSessionList
      .mockResolvedValueOnce({ data: first, totalCount: 101 })
      .mockResolvedValueOnce({ data: [sess("s100")], totalCount: 101 });
    client.sessions.revokeSession.mockImplementation(
      async (id: string) => void order.push(`revoke:${id}`)
    );

    expect(await banStaff("u1")).toEqual({ ok: true });
    expect(order[0]).toBe("ban");
    expect(client.sessions.revokeSession).toHaveBeenCalledTimes(101);
    expect(client.sessions.getSessionList).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: "u1", status: "active", offset: 100 })
    );
  });

  it("returns ok:false when Clerk throws", async () => {
    client.users.banUser.mockRejectedValue(new Error("boom"));
    expect(await banStaff("u1")).toEqual(FAIL);
    expect(client.sessions.revokeSession).not.toHaveBeenCalled();
  });
});

describe("unbanStaff / inviteStaff", () => {
  it("unbans", async () => {
    client.users.unbanUser.mockResolvedValue({});
    expect(await unbanStaff("u1")).toEqual({ ok: true });
    expect(client.users.unbanUser).toHaveBeenCalledWith("u1");
  });

  it("invites with the login redirect and ignoreExisting", async () => {
    client.invitations.createInvitation.mockResolvedValue({});
    expect(await inviteStaff("a@b.com")).toEqual({ ok: true });
    expect(client.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: "a@b.com",
      redirectUrl: "https://crm.example.com/login",
      notify: true,
      ignoreExisting: true,
    });
  });

  it("invite fails closed with no configured app URL", async () => {
    vi.stubEnv("STAFF_ORIGINS", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await inviteStaff("a@b.com")).toEqual(FAIL);
    expect(client.invitations.createInvitation).not.toHaveBeenCalled();
  });
});

describe("revokeStaffSession", () => {
  it("refuses a session that belongs to someone else", async () => {
    client.sessions.getSession.mockResolvedValue({ id: "x", userId: "other" });
    expect(await revokeStaffSession("u1", "x")).toEqual({
      ok: false,
      error: "Not your session.",
    });
    expect(client.sessions.revokeSession).not.toHaveBeenCalled();
  });

  it("revokes an owned session", async () => {
    client.sessions.getSession.mockResolvedValue({ id: "x", userId: "u1" });
    client.sessions.revokeSession.mockResolvedValue({});
    expect(await revokeStaffSession("u1", "x")).toEqual({ ok: true });
    expect(client.sessions.revokeSession).toHaveBeenCalledWith("x");
  });

  it("returns ok:false on a Clerk error", async () => {
    client.sessions.getSession.mockRejectedValue(new Error("boom"));
    expect(await revokeStaffSession("u1", "x")).toEqual(FAIL);
  });
});

describe("listActiveStaffSessions", () => {
  it("maps latestActivity", async () => {
    client.sessions.getSessionList.mockResolvedValue({
      data: [
        {
          id: "s1",
          userId: "u1",
          lastActiveAt: 1_700_000_000_000,
          latestActivity: {
            browserName: "Chrome",
            browserVersion: "120",
            deviceType: "Mac",
            city: "Austin",
            country: "US",
            ipAddress: "1.2.3.4",
          },
        },
        { id: "s2", userId: "u1", lastActiveAt: 1_700_000_000_000 },
      ],
      totalCount: 2,
    });
    const r = await listActiveStaffSessions("u1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessions[0]).toEqual({
      id: "s1",
      lastActiveAt: new Date(1_700_000_000_000),
      browser: "Chrome 120",
      device: "Mac",
      location: "Austin, US",
      ipAddress: "1.2.3.4",
    });
    expect(r.sessions[1].browser).toBeNull();
  });

  it("returns ok:false on error", async () => {
    client.sessions.getSessionList.mockRejectedValue(new Error("x"));
    expect(await listActiveStaffSessions("u1")).toEqual(FAIL);
  });
});
