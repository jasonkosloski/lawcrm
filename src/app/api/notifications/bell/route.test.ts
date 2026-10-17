/**
 * Tests for the bell read endpoint: it must authenticate itself (the
 * proxy only sniffs the cookie), return the viewer's bell state with
 * no-store caching, and fail closed / generic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/queries/notifications", () => ({
  getNotificationsBell: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { getNotificationsBell } from "@/lib/queries/notifications";
import { GET } from "./route";

const mockedSession = vi.mocked(getSession);
const mockedBell = vi.mocked(getNotificationsBell);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/notifications/bell", () => {
  it("401s without a session and never reads notifications", async () => {
    mockedSession.mockResolvedValue(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mockedBell).not.toHaveBeenCalled();
  });

  it("401s for a stale session object with no user id", async () => {
    mockedSession.mockResolvedValue({ user: {} } as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockedBell).not.toHaveBeenCalled();
  });

  it("returns the viewer's bell state, uncached, with dates as ISO strings", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1" } } as never);
    mockedBell.mockResolvedValue({
      unreadCount: 1,
      recent: [
        {
          id: "n1",
          type: "generic",
          title: "Hello",
          body: null,
          link: null,
          matterId: null,
          matterName: null,
          isRead: false,
          createdAt: new Date("2026-04-15T12:00:00.000Z"),
        },
      ],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.unreadCount).toBe(1);
    expect(json.recent[0].createdAt).toBe("2026-04-15T12:00:00.000Z");
  });

  it("a query failure is a generic 500 (details only in the server log)", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1" } } as never);
    mockedBell.mockRejectedValue(new Error("pool timeout: secret detail"));
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("secret detail");
  });
});
