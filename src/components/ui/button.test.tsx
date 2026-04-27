/**
 * Tests for the Button wrapper around `@base-ui/react/button`.
 *
 * The wrapper exists mainly to attach our `cva` variants, but
 * one behavioral wrinkle deserves a regression test: Base UI's
 * `nativeButton` prop defaults to `true`, which causes a runtime
 * warning whenever the rendered element isn't a real <button>.
 * We frequently swap in <Link> via the `render` prop (so that
 * "New matter" etc. behaves like a real <a> for cmd-click and
 * accessibility). To suppress the warning without losing native
 * button semantics elsewhere, the wrapper:
 *
 *   - defaults `nativeButton` to `false` when `render` is provided
 *     (caller is rendering something other than a <button>);
 *   - leaves `nativeButton` undefined (Base UI's default of `true`)
 *     when no render override is supplied;
 *   - lets callers who really do pass a <button> via render
 *     override with `nativeButton={true}`.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button — render passthrough + nativeButton inference", () => {
  test("renders a <button> by default", () => {
    render(<Button>Press me</Button>);
    expect(screen.getByRole("button", { name: /press me/i }).tagName).toBe(
      "BUTTON"
    );
  });

  test("renders the custom element passed via render", () => {
    render(
      <Button render={<a href="/somewhere" />}>Go</Button>
    );
    const el = screen.getByText(/go/i);
    expect(el.tagName).toBe("A");
    expect(el).toHaveAttribute("href", "/somewhere");
  });

  test("applies the variant className regardless of render override", () => {
    const { container } = render(
      <Button variant="outline" render={<a href="/x" />}>
        Outline link
      </Button>
    );
    // The cva root class is on the rendered element.
    const el = container.querySelector("a");
    expect(el).toBeTruthy();
    expect(el!.className).toMatch(/border-border/);
  });

  test("explicit nativeButton overrides the inferred default", () => {
    // If the caller really does render a <button> via render, they
    // can pass nativeButton={true} to keep the warning checks on.
    render(
      <Button nativeButton render={<button type="submit" />}>
        Submit
      </Button>
    );
    const btn = screen.getByRole("button", { name: /submit/i });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("type", "submit");
  });

  test("size variant applies on a render-overridden element", () => {
    const { container } = render(
      <Button size="sm" render={<a href="/x" />}>
        Small
      </Button>
    );
    const el = container.querySelector("a");
    expect(el!.className).toMatch(/h-7/);
  });
});
