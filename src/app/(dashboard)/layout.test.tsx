/**
 * (dashboard) layout — auth gate + ?next= preservation.
 *
 * The layout is a UX gate / redirect convenience (pages and actions
 * authenticate themselves; the proxy is only a cookie-presence
 * sniff). These tests pin two things:
 *   1. A missing session redirects to /login, carrying the
 *      original destination via ?next= — sourced from the
 *      `x-pathname` header that src/proxy.ts injects (pathname +
 *      search). Without that header we must land on bare /login,
 *      never a guessed path.
 *   2. A valid session renders children inside the AppShell and
 *      never redirects.
 *
 * We do NOT re-test ?next= sanitization here — that belongs to the
 * /login page (see src/app/login/page.test.tsx), which is the code
 * that actually consumes the param.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// `redirect()` in real Next throws to halt rendering — the mock must
// do the same or the layout would fall through and render the shell
// after "redirecting", masking bugs in the unauthenticated branch.
const REDIRECT_SENTINEL = "TEST_NEXT_REDIRECT";
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`${REDIRECT_SENTINEL}:${url}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/staff-auth", () => ({ getStaffAuth: vi.fn() }));
// server-only module (Prisma); the zone comes from the user's profile.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "Pacific/Honolulu"),
}));

vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));

vi.mock("@/components/auth/staff-clerk-provider", () => ({
  StaffClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Leaf layout chrome — we only care that children pass through.
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getStaffAuth } from "@/lib/staff-auth";
import { useUserTimeZone } from "@/components/user-time-zone";
import { getCurrentFirm } from "@/lib/firm";
import DashboardLayout, { generateMetadata } from "./layout";

const mockedAuth = vi.mocked(getStaffAuth);
const mockedRedirect = vi.mocked(redirect);
const mockedHeaders = vi.mocked(headers);
const mockedFirm = vi.mocked(getCurrentFirm);

/** Only the name fields matter to the tab title. */
const withFirm = (name: string, shortName: string | null) =>
  mockedFirm.mockResolvedValue({ name, shortName } as Awaited<ReturnType<typeof getCurrentFirm>>);

const signedIn = () =>
  mockedAuth.mockResolvedValue({
    status: "ok",
    userId: "user_1",
    clerkUserId: "clerk_1",
    sessionId: "sess_1",
  });
const signedOut = () => mockedAuth.mockResolvedValue({ status: "signed_out" });
/** Clerk session exists but no active firm user maps to it. */
const noAccess = () =>
  mockedAuth.mockResolvedValue({
    status: "no_access",
    clerkUserId: "clerk_1",
  });

/** Simulate the request headers the proxy forwarded (or didn't). */
const withHeaders = (entries: Record<string, string>) =>
  mockedHeaders.mockResolvedValue(
    new Headers(entries) as unknown as Awaited<ReturnType<typeof headers>>,
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe("DashboardLayout — unauthenticated redirect", () => {
  test("carries pathname + search from x-pathname into ?next=", async () => {
    signedOut();
    withHeaders({ "x-pathname": "/matters/abc?tab=notes" });
    await expect(DashboardLayout({ children: null })).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent("/matters/abc?tab=notes")}`,
    );
  });

  test("missing x-pathname falls back to bare /login", async () => {
    signedOut();
    withHeaders({});
    await expect(DashboardLayout({ children: null })).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/login");
  });

  test('x-pathname of "/" omits the redundant ?next=', async () => {
    signedOut();
    withHeaders({ "x-pathname": "/" });
    await expect(DashboardLayout({ children: null })).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/login");
  });

  test("signed in without firm access goes to /no-access, not /login", async () => {
    noAccess();
    withHeaders({ "x-pathname": "/settings" });
    await expect(DashboardLayout({ children: null })).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/no-access");
  });
});

describe("DashboardLayout — authenticated", () => {
  test("renders children in the AppShell without redirecting", async () => {
    signedIn();
    render(await DashboardLayout({ children: <span>page content</span> }));
    expect(screen.getByTestId("app-shell")).toHaveTextContent("page content");
    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  test("hands the user's profile zone (not the runtime's) to client components", async () => {
    signedIn();
    function ZoneProbe() {
      return <span>{useUserTimeZone()}</span>;
    }
    render(await DashboardLayout({ children: <ZoneProbe /> }));
    expect(screen.getByTestId("app-shell")).toHaveTextContent("Pacific/Honolulu");
  });
});

describe("DashboardLayout — tab title", () => {
  test("uses the signed-in user's firm short name", async () => {
    signedIn();
    withFirm("Kosloski Law Firm, P.C.", "Kosloski Law");
    expect(await generateMetadata()).toEqual({
      title: { default: "Kosloski Law", template: "%s · Kosloski Law" },
    });
  });

  test("falls back to the legal name when no short name is set", async () => {
    signedIn();
    withFirm("Kosloski Law Firm, P.C.", "  ");
    expect(await generateMetadata()).toEqual({
      title: {
        default: "Kosloski Law Firm, P.C.",
        template: "%s · Kosloski Law Firm, P.C.",
      },
    });
  });

  test("signed out adds nothing and reads no firm", async () => {
    signedOut();
    expect(await generateMetadata()).toEqual({});
    expect(mockedFirm).not.toHaveBeenCalled();
  });
});
