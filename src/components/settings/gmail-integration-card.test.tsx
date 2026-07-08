/**
 * Tests for GmailIntegrationCard.
 *
 * Pinned: the three top-level renders (not-configured guidance vs.
 * connect button vs. account list), the callback banner mapping
 * (?connected / known ?error code / UNKNOWN code must render the
 * generic line — never the raw code), syncError surfacing, and the
 * two-step disconnect confirm actually reaching the server action
 * with the right account id (and NOT reaching it on cancel), and
 * the "Load older emails" backfill affordance (anchor date + button
 * only with local mail on a connected account, action wiring,
 * imported-count / error feedback).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the server actions + router BEFORE importing the component.
vi.mock("@/app/actions/email-accounts", () => ({
  disconnectEmailAccount: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/email-sync", () => ({
  backfillMyEmailAccount: vi.fn(async () => ({ ok: true, threadsSynced: 0 })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { disconnectEmailAccount } from "@/app/actions/email-accounts";
import { backfillMyEmailAccount } from "@/app/actions/email-sync";
import {
  GmailIntegrationCard,
  type GmailAccountView,
} from "./gmail-integration-card";

const mockedDisconnect = vi.mocked(disconnectEmailAccount);
const mockedBackfill = vi.mocked(backfillMyEmailAccount);

beforeEach(() => {
  // Call history would otherwise leak across tests (the disconnect
  // test's call would satisfy the cancel test's not-called check's
  // inverse).
  mockedDisconnect.mockClear();
  mockedBackfill.mockClear();
  mockedBackfill.mockResolvedValue({ ok: true, threadsSynced: 0 });
});

const CONNECTED_ACCOUNT: GmailAccountView = {
  id: "acct-1",
  emailAddress: "jason@kosloskilaw.com",
  syncStatus: "connected",
  lastSyncLabel: "Jul 7, 2026, 9:14 AM",
  threadCount: 42,
  syncError: null,
  oldestThreadLabel: "Apr 8, 2026",
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

describe("Load older emails (backfill)", () => {
  test("shows the oldest-thread anchor date next to the button", () => {
    renderCard({ accounts: [CONNECTED_ACCOUNT] });
    expect(screen.getByText("Oldest thread Apr 8, 2026")).toBeInTheDocument();
    expect(screen.getByText("Load older emails")).toBeInTheDocument();
  });

  test("hidden when the account has no local threads to anchor on", () => {
    renderCard({
      accounts: [{ ...CONNECTED_ACCOUNT, oldestThreadLabel: null }],
    });
    expect(screen.queryByText("Load older emails")).not.toBeInTheDocument();
  });

  test("hidden on a disconnected account", () => {
    renderCard({
      accounts: [{ ...CONNECTED_ACCOUNT, syncStatus: "disconnected" }],
    });
    expect(screen.queryByText("Load older emails")).not.toBeInTheDocument();
  });

  test("click calls the action with the account id and reports the imported count", async () => {
    const user = userEvent.setup();
    mockedBackfill.mockResolvedValue({ ok: true, threadsSynced: 37 });
    renderCard({ accounts: [CONNECTED_ACCOUNT] });

    await user.click(screen.getByText("Load older emails"));

    expect(mockedBackfill).toHaveBeenCalledExactlyOnceWith("acct-1");
    await waitFor(() => {
      expect(
        screen.getByText("Imported 37 older threads.")
      ).toBeInTheDocument();
    });
  });

  test("reports when the window found nothing older", async () => {
    const user = userEvent.setup();
    renderCard({ accounts: [CONNECTED_ACCOUNT] });

    await user.click(screen.getByText("Load older emails"));
    await waitFor(() => {
      expect(screen.getByText("No older emails found.")).toBeInTheDocument();
    });
  });

  test("surfaces a failed backfill inline without losing the button", async () => {
    const user = userEvent.setup();
    mockedBackfill.mockResolvedValue({
      ok: false,
      threadsSynced: 0,
      error: "Gmail is down",
    });
    renderCard({ accounts: [CONNECTED_ACCOUNT] });

    await user.click(screen.getByText("Load older emails"));
    await waitFor(() => {
      expect(screen.getByText("Gmail is down")).toBeInTheDocument();
    });
    expect(screen.getByText("Load older emails")).toBeInTheDocument();
  });
});
