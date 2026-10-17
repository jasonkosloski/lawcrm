/**
 * MatterTabs — active-tab detection, aria-current, and the removal of
 * the tab-bar "Add ..." button (F316): it opened a placeholder panel
 * with a disabled Save on every tab it appeared on.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let pathname = "/matters/m1";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

import { MatterTabs } from "./matter-tabs";

function active(): string | null {
  const link = screen
    .getAllByRole("link")
    .find((l) => l.getAttribute("aria-current") === "page");
  return link?.textContent ?? null;
}

describe("MatterTabs", () => {
  test("Overview is active only on the bare matter path", () => {
    pathname = "/matters/m1";
    render(<MatterTabs matterId="m1" />);
    expect(active()).toBe("Overview");
  });

  test("a nested tab route activates its tab, not Overview", () => {
    pathname = "/matters/m1/deadlines";
    render(<MatterTabs matterId="m1" />);
    expect(active()).toBe("Deadlines");
  });

  test("a non-tab sub-route (edit) activates nothing", () => {
    pathname = "/matters/m1/edit";
    render(<MatterTabs matterId="m1" />);
    expect(active()).toBeNull();
  });

  test.each(["events", "documents", "deadlines", "tasks", "time"])(
    "the %s tab has no dead 'Add ...' button",
    (slug) => {
      pathname = `/matters/m1/${slug}`;
      render(<MatterTabs matterId="m1" />);
      expect(screen.queryByRole("button")).toBeNull();
    }
  );
});
