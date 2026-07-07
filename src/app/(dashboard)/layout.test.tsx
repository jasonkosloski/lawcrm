/**
 * (dashboard) layout — auth gate + ?next= preservation.
 *
 * The layout is the authoritative auth check (the proxy is only a
 * cookie-presence sniff). These tests pin two things:
 *   1. A missing/stale session redirects to /login, carrying the
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
vi.mock("@/auth", () => ({ auth: vi.fn() }));

// Leaf layout chrome — we only care that children pass through.
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import DashboardLayout from "./layout";

const mockedAuth = vi.mocked(auth);
const mockedRedirect = vi.mocked(redirect);
const mockedHeaders = vi.mocked(headers);

const signedIn = () =>
  mockedAuth.mockResolvedValue({ user: { id: "user_1" } } as never);
const signedOut = () => mockedAuth.mockResolvedValue(null as never);
/** Stale JWT: session object exists but the jwt callback wiped the id. */
const staleSession = () =>
  mockedAuth.mockResolvedValue({ user: {} } as never);

/** Simulate the request headers the proxy forwarded (or didn't). */
const withHeaders = (entries: Record<string, string>) =>
  mockedHeaders.mockResolvedValue(
    new Headers(entries) as unknown as Awaited<ReturnType<typeof headers>>
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe("DashboardLayout — unauthenticated redirect", () => {
  test("carries pathname + search from x-pathname into ?next=", async () => {
    signedOut();
    withHeaders({ "x-pathname": "/matters/abc?tab=notes" });
    await expect(
      DashboardLayout({ children: null })
    ).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent("/matters/abc?tab=notes")}`
    );
  });

  test("missing x-pathname falls back to bare /login", async () => {
    signedOut();
    withHeaders({});
    await expect(
      DashboardLayout({ children: null })
    ).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/login");
  });

  test('x-pathname of "/" omits the redundant ?next=', async () => {
    signedOut();
    withHeaders({ "x-pathname": "/" });
    await expect(
      DashboardLayout({ children: null })
    ).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/login");
  });

  test("stale JWT (session without user id) is treated as signed out", async () => {
    staleSession();
    withHeaders({ "x-pathname": "/settings" });
    await expect(
      DashboardLayout({ children: null })
    ).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent("/settings")}`
    );
  });
});

describe("DashboardLayout — authenticated", () => {
  test("renders children in the AppShell without redirecting", async () => {
    signedIn();
    render(
      await DashboardLayout({ children: <span>page content</span> })
    );
    expect(screen.getByTestId("app-shell")).toHaveTextContent(
      "page content"
    );
    expect(mockedRedirect).not.toHaveBeenCalled();
  });
});
