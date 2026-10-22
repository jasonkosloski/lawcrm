import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const push = vi.fn();
let throwInCallback = false;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@clerk/nextjs", () => ({
  HandleSSOCallback: () => {
    if (throwInCallback) throw new Error("callback exploded");
    return <div data-testid="clerk-callback" />;
  },
}));

import { SsoCallback, SSO_CALLBACK_TIMEOUT_MS } from "./sso-callback";

beforeEach(() => {
  vi.useFakeTimers();
  throwInCallback = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SsoCallback", () => {
  test("renders the Clerk callback while it is working", () => {
    render(<SsoCallback next="/" />);
    expect(screen.getByTestId("clerk-callback")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("shows the failure message with a link to /login after the timeout", () => {
    render(<SsoCallback next="/" />);
    act(() => {
      vi.advanceTimersByTime(SSO_CALLBACK_TIMEOUT_MS + 1);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in didn't complete.");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/login");
  });

  test("shows the failure message when the callback throws", () => {
    throwInCallback = true;
    render(<SsoCallback next="/" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in didn't complete.");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/login");
  });

  test("does not show the failure before the timeout", () => {
    render(<SsoCallback next="/" />);
    act(() => {
      vi.advanceTimersByTime(SSO_CALLBACK_TIMEOUT_MS - 100);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
