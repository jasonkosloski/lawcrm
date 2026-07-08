/**
 * Tests for GmailIntegrationCard.
 *
 * Pinned: the three top-level renders (not-configured guidance vs.
 * connect button vs. account list), the callback banner mapping
 * (?connected / known ?error code / UNKNOWN code must render the
 * generic line — never the raw code), syncError surfacing, and the
 * two-step disconnect confirm actually reaching the server action
 * with the right account id (and NOT reaching it on cancel).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the server action + router BEFORE importing the component.
vi.mock("@/app/actions/email-accounts", () => ({
  disconnectEmailAccount: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { disconnectEmailAccount } from "@/app/actions/email-accounts";
import {
  GmailIntegrationCard,
  type GmailAccountView,
} from "./gmail-integration-card";

const mockedDisconnect = vi.mocked(disconnectEmailAccount);

beforeEach(() => {
  // Call history would otherwise leak across tests (the disconnect
  // test's call would satisfy the cancel test's not-called check's
  // inverse).
  mockedDisconnect.mockClear();
});

const CONNECTED_ACCOUNT: GmailAccountView = {
  id: "acct-1",
  emailAddress: "jason@kosloskilaw.com",
  syncStatus: "connected",
  lastSyncLabel: "Jul 7, 2026, 9:14 AM",
  threadCount: 42,
  syncError: null,
};

function renderCard(overrides?: Partial<Parameters<typeof GmailIntegrationCard>[0]>) {
  return render(
    <GmailIntegrationCard
      configured
      accounts={[]}
      justConnected={false}
      errorCode={null}
      {...overrides}
    />
  );
}

describe("GmailIntegrationCard", () => {
  test("not configured: setup guidance, no connect link", () => {
    renderCard({ configured: false });
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByText(/GOOGLE_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.queryByText("Connect Gmail")).not.toBeInTheDocument();
  });

  test("configured, no accounts: Connect Gmail links to the OAuth route", () => {
    renderCard();
    const link = screen.getByText("Connect Gmail").closest("a");
    expect(link).toHaveAttribute("href", "/api/integrations/google/connect");
  });

  test("connected account: address, status chip, last sync, thread count + Connect another", () => {
    renderCard({ accounts: [CONNECTED_ACCOUNT] });
    expect(screen.getByText("jason@kosloskilaw.com")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(
      screen.getByText(/Last sync Jul 7, 2026, 9:14 AM/)
    ).toBeInTheDocument();
    expect(screen.getByText(/42 threads/)).toBeInTheDocument();
    expect(screen.getByText("Connect another mailbox")).toBeInTheDocument();
  });

  test("error account surfaces syncError + Needs attention chip; disconnected gets Reconnect", () => {
    renderCard({
      accounts: [
        {
          ...CONNECTED_ACCOUNT,
          syncStatus: "error",
          syncError: "Google authorization was revoked — reconnect.",
        },
        {
          ...CONNECTED_ACCOUNT,
          id: "acct-2",
          emailAddress: "second@gmail.com",
          syncStatus: "disconnected",
        },
      ],
    });
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(
      screen.getByText("Google authorization was revoked — reconnect.")
    ).toBeInTheDocument();
    expect(screen.getByText("Reconnect").closest("a")).toHaveAttribute(
      "href",
      "/api/integrations/google/connect"
    );
  });

  test("banners: connected success, mapped error copy, generic line for unknown codes", () => {
    const { unmount } = renderCard({ justConnected: true });
    expect(screen.getByText(/Gmail connected/)).toBeInTheDocument();
    unmount();

    const { unmount: unmount2 } = renderCard({ errorCode: "denied" });
    expect(screen.getByText(/cancelled/)).toBeInTheDocument();
    unmount2();

    renderCard({ errorCode: "some_future_code" });
    expect(
      screen.getByText(/Something went wrong connecting Gmail/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/some_future_code/)).not.toBeInTheDocument();
  });

  test("disconnect is two-step and calls the action with the account id", async () => {
    const user = userEvent.setup();
    renderCard({ accounts: [CONNECTED_ACCOUNT] });

    await user.click(screen.getByText("Disconnect"));
    expect(mockedDisconnect).not.toHaveBeenCalled();
    expect(screen.getByText("Disconnect mailbox?")).toBeInTheDocument();

    await user.click(screen.getByText("Confirm"));
    expect(mockedDisconnect).toHaveBeenCalledWith("acct-1");
  });

  test("cancel backs out without calling the action", async () => {
    const user = userEvent.setup();
    renderCard({ accounts: [CONNECTED_ACCOUNT] });
    await user.click(screen.getByText("Disconnect"));
    await user.click(screen.getByText("Cancel"));
    expect(mockedDisconnect).not.toHaveBeenCalled();
    expect(screen.queryByText("Disconnect mailbox?")).not.toBeInTheDocument();
  });
});
