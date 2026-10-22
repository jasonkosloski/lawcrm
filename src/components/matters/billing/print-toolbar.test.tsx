/**
 * Tests for PrintToolbar.
 *
 * The toolbar's behavior boils down to a few things worth pinning:
 *   1. When `autoprint` is true, `window.print()` fires on mount
 *      once the web fonts have loaded (`document.fonts.ready`), so
 *      the PDF snapshot never uses fallback faces. A cap keeps a
 *      font that never resolves from blocking the print, and a
 *      missing `document.fonts` falls back to the cap alone.
 *   2. Unmounting before that point cancels the print.
 *   3. When `autoprint` is false, no auto-print fires — manual
 *      click on the Print button is the only path.
 *
 * The toolbar's chrome (Print button + Close) hides during
 * print via the `print:hidden` Tailwind class, which can't be
 * meaningfully unit-tested (it's a CSS rule). Trust it.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintToolbar } from "./print-toolbar";

function setFonts(value: unknown) {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    writable: true,
    value,
  });
}

describe("PrintToolbar", () => {
  let printSpy: ReturnType<typeof vi.fn>;
  const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");

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
    if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
    else delete (document as unknown as { fonts?: unknown }).fonts;
  });

  test("auto-prints only after document.fonts.ready resolves", async () => {
    let resolveFonts!: () => void;
    setFonts({
      ready: new Promise<void>((resolve) => {
        resolveFonts = resolve;
      }),
    });
    render(<PrintToolbar autoprint />);

    // Well past the old fixed 250 ms delay: fonts still loading, so
    // nothing printed yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(printSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveFonts();
    });
    expect(printSpy).toHaveBeenCalledOnce();
  });

  test("prints anyway after the cap if fonts never resolve", async () => {
    setFonts({ ready: new Promise<void>(() => {}) });
    render(<PrintToolbar autoprint />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
    });
    expect(printSpy).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(printSpy).toHaveBeenCalledOnce();
  });

  test("without a fonts API it prints after the cap", async () => {
    setFonts(undefined);
    render(<PrintToolbar autoprint />);
    expect(printSpy).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(printSpy).toHaveBeenCalledOnce();
  });

  test("unmounting before fonts load cancels the print", async () => {
    let resolveFonts!: () => void;
    setFonts({
      ready: new Promise<void>((resolve) => {
        resolveFonts = resolve;
      }),
    });
    const { unmount } = render(<PrintToolbar autoprint />);
    unmount();
    await act(async () => {
      resolveFonts();
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(printSpy).not.toHaveBeenCalled();
  });

  test("does NOT auto-print when autoprint is false", async () => {
    setFonts({ ready: Promise.resolve() });
    render(<PrintToolbar autoprint={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(printSpy).not.toHaveBeenCalled();
  });

  test("manual Print button triggers window.print()", async () => {
    // Use real timers for user events; vi.useRealTimers() is fine
    // mid-test because we already verified the auto-print path.
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<PrintToolbar autoprint={false} />);
    await user.click(screen.getByRole("button", { name: /print or save as pdf/i }));
    expect(printSpy).toHaveBeenCalledOnce();
  });
});
