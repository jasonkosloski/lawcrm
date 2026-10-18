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

  test("the Billing tab link is hidden without billing.view and shown with it", () => {
    pathname = "/matters/m1";
    const { unmount } = render(<MatterTabs matterId="m1" canViewBilling={false} />);
    expect(screen.queryByRole("link", { name: "Billing" })).toBeNull();
    expect(screen.getByRole("link", { name: "Time & expenses" })).toBeTruthy();
    unmount();
    render(<MatterTabs matterId="m1" canViewBilling />);
    expect(screen.getByRole("link", { name: "Billing" })).toBeTruthy();
  });

  test("the Records tab follows Documents and is hidden without records.view", () => {
    pathname = "/matters/m1/records";
    const { unmount } = render(<MatterTabs matterId="m1" />);
    const labels = screen.getAllByRole("link").map((l) => l.textContent);
    expect(labels.indexOf("Records")).toBe(labels.indexOf("Documents") + 1);
    expect(active()).toBe("Records");
    unmount();
    render(<MatterTabs matterId="m1" canViewRecords={false} />);
    expect(screen.queryByRole("link", { name: "Records" })).toBeNull();
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
