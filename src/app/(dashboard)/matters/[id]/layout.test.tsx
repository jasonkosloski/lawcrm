/** Matter header: the Fee label is the derived billing type. */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  usePathname: () => "/matters/m1",
}));
vi.mock("@/lib/matter-access", () => ({ assertMatterAccess: vi.fn(async () => "u") }));
vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn(async () => "u") }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => false),
}));
vi.mock("@/lib/queries/notification-preferences", () => ({
  isMatterEmailMuted: vi.fn(async () => false),
}));
const matter = {
  id: "m1",
  name: "State v. Doe",
  caseNumber: null,
  color: "#123",
  stage: "Intake",
  area: "Criminal",
  restricted: false,
  client: null,
  court: null,
  feeStructure: "hourly",
  billingMode: "court_voucher",
  isPinnedByCurrentUser: false,
  teamMembers: [],
};
vi.mock("@/lib/queries/matters", () => ({
  getMatterById: vi.fn(async () => matter),
}));
vi.mock("@/components/layout/topbar", () => ({
  TopBar: (p: { subtitle?: React.ReactNode }) => <div>{p.subtitle}</div>,
}));
vi.mock("@/components/matters/matter-tabs", () => ({ MatterTabs: () => null }));
vi.mock("@/components/matters/pin-toggle", () => ({ PinToggle: () => null }));
vi.mock("@/components/matters/email-mute-toggle", () => ({ EmailMuteToggle: () => null }));
vi.mock("@/components/matters/matter-create-menu", () => ({ MatterCreateMenu: () => null }));
vi.mock("@/components/create-stack/create-dock", () => ({ CreateDock: () => null }));
vi.mock("@/components/create-stack/create-stack-provider", () => ({
  CreateStackProvider: (p: { children: React.ReactNode }) => <>{p.children}</>,
}));

import MatterDetailLayout from "./layout";

describe("MatterDetailLayout", () => {
  test("a court_voucher matter's Fee label reads Court-appointed", async () => {
    const ui = await MatterDetailLayout({
      children: null,
      params: Promise.resolve({ id: "m1" }),
    } as never);
    render(ui);
    expect(screen.getByText("Court-appointed")).toBeTruthy();
    expect(screen.queryByText("Hourly")).toBeNull();
  });
});
