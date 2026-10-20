import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const REDIRECT_SENTINEL = "TEST_NEXT_REDIRECT";
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`${REDIRECT_SENTINEL}:${url}`);
  }),
}));
vi.mock("@/lib/staff-auth", () => ({ getStaffAuth: vi.fn() }));
vi.mock("@/components/auth/staff-clerk-provider", () => ({
  StaffClerkProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));

import { redirect } from "next/navigation";
import { getStaffAuth } from "@/lib/staff-auth";
import NoAccessPage from "./page";

const mockedAuth = vi.mocked(getStaffAuth);

afterEach(() => {
  vi.clearAllMocks();
});

describe("/no-access", () => {
  test("shows the explanation and a sign-out button for no_access", async () => {
    mockedAuth.mockResolvedValue({
      status: "no_access",
      clerkUserId: "clerk_1",
    });
    render(await NoAccessPage());
    expect(
      screen.getByRole("heading", { name: "No access to LitGox" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/this account isn.t set up as a firm member/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" })
    ).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  test("a firm member is sent home", async () => {
    mockedAuth.mockResolvedValue({
      status: "ok",
      userId: "u1",
      clerkUserId: "clerk_1",
      sessionId: "sess_1",
    });
    await expect(NoAccessPage()).rejects.toThrow(`${REDIRECT_SENTINEL}:/`);
  });

  test("a signed-out visitor is sent to /login", async () => {
    mockedAuth.mockResolvedValue({ status: "signed_out" });
    await expect(NoAccessPage()).rejects.toThrow(
      `${REDIRECT_SENTINEL}:/login`
    );
  });
});
