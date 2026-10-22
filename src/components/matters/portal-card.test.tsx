import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("@/app/actions/portal-billing", () => ({
  setPortalBilling: vi.fn(),
}));
vi.mock("@/app/actions/portal-access", () => ({
  invitePortalUser: vi.fn(),
  revokePortalAccess: vi.fn(),
}));

import { invitePortalUser, revokePortalAccess } from "@/app/actions/portal-access";
import { setPortalBilling } from "@/app/actions/portal-billing";
import { confirmAction } from "@/lib/feedback";
import { PortalCard } from "./portal-card";
import type { PortalAccessRow } from "@/lib/queries/portal-access";

const row = (over: Partial<PortalAccessRow>): PortalAccessRow => ({
  accessId: "a1",
  identityId: "i1",
  contactName: "Jane Client",
  email: "jane@example.com",
  invitedAt: new Date("2026-10-01T12:00:00Z"),
  lastSignInAt: null,
  revokedAt: null,
  ...over,
});

const contacts = [
  { id: "c1", name: "Jane Client", email: "jane@example.com" },
  { id: "c2", name: "Bob Spouse", email: "bob@example.com" },
];

const renderCard = (over: Partial<React.ComponentProps<typeof PortalCard>> = {}) =>
  render(
    <PortalCard
      matterId="m1"
      rows={[]}
      contacts={contacts}
      canInvite
      canRevoke
      portalEnabled
      tz="America/Denver"
      {...over}
    />,
  );

beforeEach(() => {
  vi.mocked(invitePortalUser).mockResolvedValue({ ok: true });
  vi.mocked(revokePortalAccess).mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("PortalCard", () => {
  test("lists people with Invited / Active (last sign-in) / Revoked status", () => {
    renderCard({
      rows: [
        row({ accessId: "a1", contactName: "Invited Ian" }),
        row({
          accessId: "a2",
          contactName: "Active Amy",
          lastSignInAt: new Date("2026-10-10T03:00:00Z"),
        }),
        row({
          accessId: "a3",
          contactName: "Revoked Rob",
          revokedAt: new Date("2026-10-12T12:00:00Z"),
        }),
      ],
    });
    expect(screen.getByText("Invited")).toBeTruthy();
    // 03:00Z is still Oct 9 in Denver: the instant renders in the viewer's zone.
    expect(screen.getByText("Active · last sign-in Oct 9, 2026")).toBeTruthy();
    expect(screen.getByText("Revoked")).toBeTruthy();
  });

  test("Invite picks a contact, pre-fills their email, allows editing, posts to invitePortalUser", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    const email = (await screen.findByLabelText("Email")) as HTMLInputElement;
    expect(email.value).toBe("jane@example.com");

    await user.selectOptions(screen.getByLabelText("Contact"), "c2");
    expect(email.value).toBe("bob@example.com");

    await user.clear(email);
    await user.type(email, "bob.new@example.com");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(invitePortalUser).toHaveBeenCalledWith("m1", "c2", "bob.new@example.com"),
    );
  });

  test("shows the action's error in the invite dialog", async () => {
    vi.mocked(invitePortalUser).mockResolvedValue({
      ok: false,
      error: "Another portal user already uses this email.",
    });
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.click(await screen.findByRole("button", { name: "Send invite" }));
    expect(await screen.findByText("Another portal user already uses this email.")).toBeTruthy();
  });

  test("Revoke asks for confirmation before calling revokePortalAccess", async () => {
    const user = userEvent.setup();
    const confirmMock = vi.mocked(confirmAction);
    confirmMock.mockResolvedValueOnce(false);
    renderCard({ rows: [row({})] });

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(revokePortalAccess).not.toHaveBeenCalled();

    confirmMock.mockResolvedValue(true);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(revokePortalAccess).toHaveBeenCalledWith("a1"));
  });

  test("no invite button without canInvite; a disabled-portal notice when portalEnabled is false", () => {
    const { unmount } = renderCard({ canInvite: false });
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    unmount();

    renderCard({ portalEnabled: false });
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    expect(screen.getByText(/turned off for the firm/)).toBeTruthy();
  });

  test("a failed revoke shows the error inline", async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(revokePortalAccess).mockResolvedValue({
      ok: false,
      error: "Couldn't revoke.",
    });
    renderCard({ rows: [row({})] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Revoke" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't revoke.");
  });

  test("no revoke button without canRevoke or on a revoked row", () => {
    const { unmount } = renderCard({ canRevoke: false, rows: [row({})] });
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    unmount();
    renderCard({ rows: [row({ revokedAt: new Date() })] });
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  describe("billing switch", () => {
    const billing = {
      portalBillingEnabled: false,
      billedPortalContacts: [] as string[],
      canShareBilling: true,
    };

    test("hidden when the loader omitted billing data (no billing.view)", () => {
      renderCard();
      expect(screen.queryByText("Show billing in the portal")).toBeNull();
    });

    test("disabled without portal.share_billing", () => {
      renderCard({ ...billing, canShareBilling: false });
      expect(screen.getByRole("switch", { name: /Show billing in the portal/ })).toBeDisabled();
    });

    test("toggling calls the action", async () => {
      vi.mocked(setPortalBilling).mockResolvedValue({ ok: true });
      renderCard(billing);
      await userEvent.click(screen.getByRole("switch", { name: /Show billing in the portal/ }));
      await waitFor(() => expect(setPortalBilling).toHaveBeenCalledWith("m1", true));
    });

    test("a thrown action reverts the switch and shows Couldn't save.", async () => {
      vi.mocked(setPortalBilling).mockRejectedValue(new Error("network"));
      renderCard(billing);
      const sw = screen.getByRole("switch", {
        name: /Show billing in the portal/,
      });
      await userEvent.click(sw);
      expect(await screen.findByText("Couldn't save.")).toBeTruthy();
      expect(sw).not.toBeChecked();
    });

    test("an error reverts the switch and is shown", async () => {
      vi.mocked(setPortalBilling).mockResolvedValue({
        ok: false,
        error: "Nope.",
      });
      renderCard(billing);
      const sw = screen.getByRole("switch", {
        name: /Show billing in the portal/,
      });
      await userEvent.click(sw);
      expect(await screen.findByText("Nope.")).toBeTruthy();
      expect(sw).not.toBeChecked();
    });

    test("when on, lists billed contacts or the empty line", () => {
      const { unmount } = renderCard({
        ...billing,
        portalBillingEnabled: true,
        billedPortalContacts: ["Amy", "Zed"],
      });
      expect(screen.getByText(/Amy, Zed/)).toBeTruthy();
      unmount();
      renderCard({ ...billing, portalBillingEnabled: true });
      expect(screen.getByText("No billed contact has portal access yet.")).toBeTruthy();
    });

    test("when off, no contact list", () => {
      renderCard(billing);
      expect(screen.queryByText("No billed contact has portal access yet.")).toBeNull();
    });
  });
});
