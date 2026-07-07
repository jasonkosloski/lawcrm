/**
 * /login page — open-redirect guard on the `?next=` param.
 *
 * The POST path is already covered by `safeRedirectPath` inside
 * `loginAction` (src/app/actions/auth.ts). These tests pin the GET
 * path: an already-authenticated user hitting
 * `/login?next=https://evil.example` must be redirected to "/",
 * never off-site, and the unauthenticated form must only ever see a
 * sanitized `next` (it echoes the value back through a hidden field
 * to the POST, so a raw value would round-trip an attacker string
 * into the form even though the action re-sanitizes).
 *
 * We do NOT re-test the form's own submit flow here — that lives
 * with loginAction. Only the page's redirect/prop plumbing.
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

vi.mock("@/auth", () => ({ auth: vi.fn() }));

// Leaf client component — we only care about the `next` prop it
// receives, not its markup.
vi.mock("@/components/auth/login-form", () => ({
  LoginForm: ({ next }: { next: string }) => (
    <div data-testid="login-form" data-next={next} />
  ),
}));

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginPage from "./page";

const mockedAuth = vi.mocked(auth);
const mockedRedirect = vi.mocked(redirect);

/** Build the async searchParams prop Next 16 passes to pages. */
const props = (next?: string | string[]) =>
  ({
    searchParams: Promise.resolve(next === undefined ? {} : { next }),
  }) as Parameters<typeof LoginPage>[0];

const signedIn = () =>
  mockedAuth.mockResolvedValue({ user: { id: "user_1" } } as never);
const signedOut = () => mockedAuth.mockResolvedValue(null as never);

afterEach(() => {
  vi.clearAllMocks();
});

describe("LoginPage — authenticated redirect", () => {
  test("absolute external URL in ?next= falls back to /", async () => {
    signedIn();
    await expect(LoginPage(props("https://evil.example"))).rejects.toThrow(
      REDIRECT_SENTINEL
    );
    expect(mockedRedirect).toHaveBeenCalledWith("/");
  });

  test("protocol-relative //evil.example falls back to /", async () => {
    signedIn();
    await expect(LoginPage(props("//evil.example"))).rejects.toThrow(
      REDIRECT_SENTINEL
    );
    expect(mockedRedirect).toHaveBeenCalledWith("/");
  });

  test("same-origin relative path passes through", async () => {
    signedIn();
    await expect(
      LoginPage(props("/matters/abc?tab=notes"))
    ).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/matters/abc?tab=notes");
  });

  test("missing ?next= redirects to /", async () => {
    signedIn();
    await expect(LoginPage(props())).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/");
  });

  test("repeated ?next= uses the first value, still sanitized", async () => {
    signedIn();
    await expect(
      LoginPage(props(["https://evil.example", "/tasks"]))
    ).rejects.toThrow(REDIRECT_SENTINEL);
    expect(mockedRedirect).toHaveBeenCalledWith("/");
  });
});

describe("LoginPage — unauthenticated form", () => {
  test("form receives sanitized next, not the raw external URL", async () => {
    signedOut();
    render(await LoginPage(props("https://evil.example")));
    expect(screen.getByTestId("login-form").dataset.next).toBe("/");
    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  test("form receives a valid relative next unchanged", async () => {
    signedOut();
    render(await LoginPage(props("/matters/abc")));
    expect(screen.getByTestId("login-form").dataset.next).toBe(
      "/matters/abc"
    );
  });
});
