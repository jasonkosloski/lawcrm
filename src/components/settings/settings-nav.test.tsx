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

describe("SettingsNav Court formats", () => {
  test("shown right after Venues for a court-format key holder", () => {
    render(
      <SettingsNav isAdmin={false} grantedPermissions={["venues.edit", "court_formats.edit"]} />,
    );
    const labels = screen.getAllByRole("link").map((l) => l.textContent);
    const i = labels.indexOf("Venues");
    expect(labels[i + 1]).toBe("Court formats");
  });
  test("hidden with no court-format key", () => {
    render(<SettingsNav isAdmin={false} grantedPermissions={["venues.edit"]} />);
    expect(screen.queryAllByText("Court formats")).toHaveLength(0);
  });
});
