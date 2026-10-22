/**
 * /login page — staff auth branches and the open-redirect guard on the
 * `?next=` param.
 *
 * An already-signed-in firm member hitting
 * `/login?next=https://evil.example` must be redirected to "/", never
 * off-site, and the signed-out page must only ever hand the sign-in
 * button a sanitized `next` (the button gives it to Clerk as the
 * post-sign-in destination). A signed-in Clerk user who is not a firm
 * member goes to /no-access, never back to the form.
 *
 * Only the page's redirect/prop plumbing is tested here; the button has
 * its own test.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// `redirect()` in real Next throws to halt rendering — the mock must
// do the same or the page would fall through and render the form
// after "redirecting", masking bugs in the authed branch.
const REDIRECT_SENTINEL = "TEST_NEXT_REDIRECT";
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`${REDIRECT_SENTINEL}:${url}`);
  }),
}));

vi.mock("@/lib/staff-auth", () => ({ getStaffAuth: vi.fn() }));

// Leaf components — we only care about the `next` prop the button
// receives, not Clerk's provider or its markup.
vi.mock("@/components/auth/staff-clerk-provider", () => ({
  StaffClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/auth/google-sign-in-button", () => ({
  GoogleSignInButton: ({ next }: { next: string }) => (
    <div data-testid="login-form" data-next={next} />
  ),
}));

import { redirect } from "next/navigation";
import { getStaffAuth } from "@/lib/staff-auth";
import LoginPage from "./page";

const mockedAuth = vi.mocked(getStaffAuth);
const mockedRedirect = vi.mocked(redirect);

/** Build the async searchParams prop Next 16 passes to pages. */
const props = (next?: string | string[]) =>
  ({
    searchParams: Promise.resolve(next === undefined ? {} : { next }),
  }) as Parameters<typeof LoginPage>[0];

const signedIn = () =>
  mockedAuth.mockResolvedValue({
    status: "ok",
    userId: "user_1",
    clerkUserId: "clerk_1",
    sessionId: "sess_1",
  });
const signedOut = () => mockedAuth.mockResolvedValue({ status: "signed_out" });
const noAccess = () =>
  mockedAuth.mockResolvedValue({
    status: "no_access",
    clerkUserId: "clerk_1",
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe("LoginPage — staff auth branches", () => {
  test("ok redirects to the sanitized next", async () => {
    signedIn();
    await expect(LoginPage(props("/matters"))).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/matters");
  });

  test("no_access goes to /no-access, not back to the form", async () => {
    noAccess();
    await expect(LoginPage(props("/matters"))).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/no-access");
  });

  test("signed_out renders the sign-in button", async () => {
    signedOut();
    render(await LoginPage(props("/matters")));
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(mockedRedirect).not.toHaveBeenCalled();
  });
});

describe("LoginPage — authenticated redirect", () => {
  test("absolute external URL in ?next= falls back to /", async () => {
    signedIn();
    await expect(LoginPage(props("https://evil.example"))).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/");
  });

  test("protocol-relative //evil.example falls back to /", async () => {
    signedIn();
    await expect(LoginPage(props("//evil.example"))).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/");
  });

  test("same-origin relative path passes through", async () => {
    signedIn();
    await expect(LoginPage(props("/matters/abc?tab=notes"))).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/matters/abc?tab=notes");
  });

  test.each([
    ["backslash", "/\\evil.example"],
    ["tab", "/\t/evil.example"],
    ["newline", "/\n/evil.example"],
  ])("%s payload in ?next= falls back to /", async (_n, payload) => {
    signedIn();
    await expect(LoginPage(props(payload))).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/");
  });

  test("missing ?next= redirects to /", async () => {
    signedIn();
    await expect(LoginPage(props())).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/");
  });

  test("repeated ?next= uses the first value, still sanitized", async () => {
    signedIn();
    await expect(LoginPage(props(["https://evil.example", "/tasks"]))).rejects.toThrow(
      REDIRECT_SENTINEL,
    );
    expect(mockedRedirect).toHaveBeenCalledWith("/");
  });
});

describe("LoginPage — signed-out button props", () => {
  test("button receives sanitized next, not the raw external URL", async () => {
    signedOut();
    render(await LoginPage(props("https://evil.example")));
    expect(screen.getByTestId("login-form").dataset.next).toBe("/");
    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  test("button receives sanitized next for a backslash payload", async () => {
    signedOut();
    render(await LoginPage(props("/\\evil.example")));
    expect(screen.getByTestId("login-form").dataset.next).toBe("/");
  });

  test("button receives a valid relative next unchanged", async () => {
    signedOut();
    render(await LoginPage(props("/matters/abc")));
    expect(screen.getByTestId("login-form").dataset.next).toBe("/matters/abc");
  });
});
