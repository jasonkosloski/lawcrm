import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/firm" }));

import { SettingsNav } from "./settings-nav";

describe("SettingsNav requiresAny", () => {
  test("Venues hidden with no venue key", () => {
    render(<SettingsNav isAdmin={false} grantedPermissions={["firm.view_activity"]} />);
    expect(screen.queryAllByText("Venues")).toHaveLength(0);
  });
  test("Venues shown with any one venue key", () => {
    render(<SettingsNav isAdmin={false} grantedPermissions={["venues.edit"]} />);
    expect(screen.getAllByText("Venues").length).toBeGreaterThan(0);
  });
  test("Venues shown for admin", () => {
    render(<SettingsNav isAdmin grantedPermissions={[]} />);
    expect(screen.getAllByText("Venues").length).toBeGreaterThan(0);
  });
});

describe("SettingsNav You section", () => {
  test("Notifications is linked for every user", () => {
    render(<SettingsNav isAdmin={false} grantedPermissions={[]} />);
    const links = screen.getAllByRole("link", { name: "Notifications" });
    expect(links[0].getAttribute("href")).toBe("/settings/notifications");
  });
});

describe("SettingsNav Documents", () => {
  test("Documents is linked for every user", () => {
    render(<SettingsNav isAdmin={false} grantedPermissions={[]} />);
    const links = screen.getAllByRole("link", { name: "Documents" });
    expect(links[0].getAttribute("href")).toBe("/settings/documents");
  });
});
