/**
 * Tests for LogTimeOnCommButton.
 *
 * The regression worth pinning: both variants must title the
 * dialog after the actual source kind. The default (full pill)
 * variant used to hardcode parentKind="task" — a copy-paste from
 * the task surface — so every email in the thread reader and every
 * voicemail card opened a dialog titled "Log time on task".
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/time-on-entity", () => ({
  addTimeEntryToEmailMessage: vi.fn(),
  addTimeEntryToMessengerItem: vi.fn(),
}));

import { LogTimeOnCommButton, type CommSource } from "./log-time-on-comm-button";

const EMAIL_SOURCE: CommSource = {
  kind: "email",
  messageId: "msg1",
  label: "Re: Settlement offer",
};

const MESSENGER_SOURCE: CommSource = {
  kind: "messenger",
  itemId: "item1",
  label: "Voicemail from client",
};

// Radix locks body pointer-events while the dialog is open;
// userEvent's computed-style check trips over that in happy-dom,
// so disable it — the elements are genuinely interactive.
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("LogTimeOnCommButton — dialog title matches source kind", () => {
  test.each([
    ["default", EMAIL_SOURCE, "Log time on email"],
    ["default", MESSENGER_SOURCE, "Log time on message"],
    ["compact", EMAIL_SOURCE, "Log time on email"],
    ["compact", MESSENGER_SOURCE, "Log time on message"],
  ] as const)(
    "%s variant with %o opens a dialog titled '%s'",
    async (variant, source, title) => {
      const user = setupUser();
      render(
        <LogTimeOnCommButton source={source} isFiled variant={variant} />
      );

      await user.click(screen.getByRole("button", { name: /log time/i }));

      expect(
        await screen.findByRole("heading", { name: title })
      ).toBeInTheDocument();
    }
  );
});
