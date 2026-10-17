/**
 * Tests for the error boundaries' recovery behavior.
 *
 * Next 16 passes both `reset` and `retry` to a boundary. `reset` only
 * clears the boundary state and re-renders the SAME cached RSC
 * payload, so a server-render failure (Prisma pool timeout...) would
 * re-throw instantly and the card would never go away. "Try again"
 * must call `retry` (re-fetch + re-render). The boundaries must also
 * survive a non-Error thrown value.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import DashboardError from "@/app/(dashboard)/error";
import RootError from "@/app/error";
import GlobalError from "@/app/global-error";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ["dashboard boundary", DashboardError],
  ["root boundary", RootError],
])("%s", (_name, Boundary) => {
  test("Try again calls retry (not reset)", async () => {
    const retry = vi.fn();
    const reset = vi.fn();
    // `reset` is passed too (Next provides both) to prove it's unused.
    const props = {
      error: new Error("pool timeout"),
      retry,
      reset,
    } as unknown as { error: unknown; retry: () => void };
    render(<Boundary {...props} />);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  test("shows the message and digest of an Error", () => {
    const error = Object.assign(new Error("boom"), { digest: "d-123" });
    render(<Boundary error={error} retry={() => {}} />);
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByText(/d-123/)).toBeInTheDocument();
  });

  test("a non-Error thrown value renders the card without throwing", () => {
    render(<Boundary error={"just a string"} retry={() => {}} />);
    expect(
      screen.getByRole("heading", { name: /something broke/i })
    ).toBeInTheDocument();
  });
});

describe("global boundary", () => {
  test("Try again calls retry (not reset) and a non-Error value doesn't throw", async () => {
    const retry = vi.fn();
    const reset = vi.fn();
    // GlobalError renders its own <html>/<body>; mount it in a div in
    // the document (React warns about nesting, which is spied above).
    const host = document.body.appendChild(document.createElement("div"));
    const props = { error: null, retry, reset } as unknown as {
      error: unknown;
      retry: () => void;
    };
    render(<GlobalError {...props} />, { container: host });
    const button = host.querySelector("button");
    expect(button).not.toBeNull();
    fireEvent.click(button!);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });
});
