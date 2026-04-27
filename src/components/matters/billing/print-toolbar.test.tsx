/**
 * Tests for PrintToolbar.
 *
 * The toolbar's behavior boils down to two things worth pinning:
 *   1. When `autoprint` is true, `window.print()` fires on mount
 *      (after the font-settle delay).
 *   2. When `autoprint` is false, no auto-print fires — manual
 *      click on the Print button is the only path.
 *
 * The toolbar's chrome (Print button + Close) hides during
 * print via the `print:hidden` Tailwind class, which can't be
 * meaningfully unit-tested (it's a CSS rule). Trust it.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintToolbar } from "./print-toolbar";

describe("PrintToolbar", () => {
  let printSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    printSpy = vi.fn();
    // happy-dom doesn't implement window.print; install our own.
    Object.defineProperty(window, "print", {
      configurable: true,
      writable: true,
      value: printSpy,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("auto-fires window.print() after the font-settle delay when autoprint is true", () => {
    render(<PrintToolbar autoprint />);
    expect(printSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(printSpy).toHaveBeenCalledOnce();
  });

  test("does NOT auto-print when autoprint is false", () => {
    render(<PrintToolbar autoprint={false} />);
    vi.advanceTimersByTime(1000);
    expect(printSpy).not.toHaveBeenCalled();
  });

  test("manual Print button triggers window.print()", async () => {
    // Use real timers for user events; vi.useRealTimers() is fine
    // mid-test because we already verified the auto-print path.
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<PrintToolbar autoprint={false} />);
    await user.click(
      screen.getByRole("button", { name: /print or save as pdf/i })
    );
    expect(printSpy).toHaveBeenCalledOnce();
  });
});
