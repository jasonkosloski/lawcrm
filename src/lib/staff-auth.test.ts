import { beforeEach, describe, expect, test, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  onPortal: vi.fn(),
  auth: vi.fn(),
  clerkClient: vi.fn(),
  authenticateRequest: vi.fn(),
  findUnique: vi.fn(),
  parties: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/portal/host", () => ({
  requestIsOnPortalHost: hoisted.onPortal,
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: hoisted.auth,
  clerkClient: hoisted.clerkClient,
}));
vi.mock("@/lib/staff-authorized-parties", () => ({
  staffAuthorizedParties: hoisted.parties,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: hoisted.findUnique } },
}));

import { getStaffAuth, getStaffAuthFromRequest } from "./staff-auth";

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.onPortal.mockResolvedValue(false);
  hoisted.clerkClient.mockResolvedValue({
    authenticateRequest: hoisted.authenticateRequest,
  });
  hoisted.parties.mockReturnValue(["https://crm.example.com"]);
});

describe("getStaffAuth", () => {
  test("portal host -> signed_out without calling Clerk", async () => {
    hoisted.onPortal.mockResolvedValue(true);
    await expect(getStaffAuth()).resolves.toEqual({ status: "signed_out" });
    expect(hoisted.auth).not.toHaveBeenCalled();
  });

  test("no Clerk user -> signed_out", async () => {
    hoisted.auth.mockResolvedValue({ userId: null, sessionId: null });
    await expect(getStaffAuth()).resolves.toEqual({ status: "signed_out" });
  });
});

describe("getStaffAuthFromRequest", () => {
  const req = new Request("https://crm.example.com/api/documents/upload");
  const stateWith = (toAuth: unknown) => ({ toAuth: () => toAuth });

  test("portal host -> signed_out without touching Clerk", async () => {
    hoisted.onPortal.mockResolvedValue(true);
    await expect(getStaffAuthFromRequest(req)).resolves.toEqual({
      status: "signed_out",
    });
    expect(hoisted.clerkClient).not.toHaveBeenCalled();
    expect(hoisted.authenticateRequest).not.toHaveBeenCalled();
  });

  test("authenticates with the shared authorized parties and session tokens only", async () => {
    hoisted.authenticateRequest.mockResolvedValue(stateWith(null));
    await getStaffAuthFromRequest(req);
    expect(hoisted.authenticateRequest).toHaveBeenCalledWith(req, {
      acceptsToken: "session_token",
      authorizedParties: hoisted.parties(),
    });
  });

  test("a null auth object (handshake) -> signed_out", async () => {
    hoisted.authenticateRequest.mockResolvedValue(stateWith(null));
    await expect(getStaffAuthFromRequest(req)).resolves.toEqual({
      status: "signed_out",
    });
  });

  test("a signed-out auth object -> signed_out", async () => {
    hoisted.authenticateRequest.mockResolvedValue(stateWith({ userId: null, sessionId: null }));
    await expect(getStaffAuthFromRequest(req)).resolves.toEqual({
      status: "signed_out",
    });
    expect(hoisted.findUnique).not.toHaveBeenCalled();
  });

  test("a linked active user -> ok", async () => {
    hoisted.authenticateRequest.mockResolvedValue(
      stateWith({ userId: "user_clerk_1", sessionId: "sess_1" }),
    );
    hoisted.findUnique.mockResolvedValue({ id: "u1", isActive: true });
    await expect(getStaffAuthFromRequest(req)).resolves.toEqual({
      status: "ok",
      userId: "u1",
      clerkUserId: "user_clerk_1",
      sessionId: "sess_1",
    });
  });
});
