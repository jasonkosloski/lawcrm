/**
 * ComposeEmailButton tests — account-picker states (none / one /
 * several), client-side address validation, action wiring, and the
 * draft-preservation contract on send failure.
 *
 * Server action + router are mocked at module level per the house
 * pattern (docs/TESTING.md layer 2). Inputs are queried by [name]
 * (the form primitives don't htmlFor-associate labels).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ComposeEmailButton } from "./compose-email";

vi.mock("@/app/actions/email-send", () => ({
  sendEmail: vi.fn(),
  replyToThread: vi.fn(),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// next/link renders fine in happy-dom, but keep it a plain anchor so
// the no-account state can assert on href without router context.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { sendEmail } from "@/app/actions/email-send";
const mockedSendEmail = vi.mocked(sendEmail);

// Base UI toggles pointer-events during popup animation; happy-dom's
// computed-style check trips on it (see follow-up-button.test.tsx).
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

const ONE_ACCOUNT = [{ id: "acc-1", emailAddress: "me@firm.com" }];
const TWO_ACCOUNTS = [
  { id: "acc-1", emailAddress: "me@firm.com" },
  { id: "acc-2", emailAddress: "litigation@firm.com" },
];

const field = (name: string): HTMLInputElement | HTMLTextAreaElement =>
  document.querySelector(`[name="${name}"]`) as
    | HTMLInputElement
    | HTMLTextAreaElement;

async function openAndFill(
  user: ReturnType<typeof setupUser>,
  over?: { to?: string }
) {
  await user.click(screen.getByRole("button", { name: /compose/i }));
  await screen.findByText("New email");
  await user.type(field("to"), over?.to ?? "alice@example.com");
  await user.type(field("subject"), "Retainer");
  await user.type(field("body"), "Hi Alice");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ComposeEmailButton — account states", () => {
  test("no connected account → Connect Gmail link, no composer", () => {
    render(<ComposeEmailButton accounts={[]} />);
    // happy-dom trap: the Base UI render-prop anchor doesn't expose
    // an accessible name to getByRole here — query by text + closest.
    const link = screen.getByText(/connect gmail/i).closest("a");
    expect(link).toHaveAttribute("href", "/settings/integrations");
    expect(
      screen.queryByRole("button", { name: /compose/i })
    ).not.toBeInTheDocument();
  });

  test("single account → no From picker, sends from it", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(<ComposeEmailButton accounts={ONE_ACCOUNT} />);

    await openAndFill(user);
    expect(document.querySelector('[name="accountId"]')).toBeNull();

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(mockedSendEmail).toHaveBeenCalledWith("acc-1", {
        to: ["alice@example.com"],
        cc: [],
        subject: "Retainer",
        bodyText: "Hi Alice",
        bodyHtml: "<p>Hi Alice</p>",
      })
    );
  });

  test("multiple accounts → From picker, chosen account is used", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(<ComposeEmailButton accounts={TWO_ACCOUNTS} />);

    await openAndFill(user);
    const picker = document.querySelector(
      '[name="accountId"]'
    ) as HTMLSelectElement;
    expect(picker).not.toBeNull();
    await user.selectOptions(picker, "acc-2");

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(mockedSendEmail).toHaveBeenCalledWith(
        "acc-2",
        expect.objectContaining({ to: ["alice@example.com"] })
      )
    );
  });
});

describe("ComposeEmailButton — validation + draft preservation", () => {
  test("invalid To address blocks the send with an inline error", async () => {
    const user = setupUser();
    render(<ComposeEmailButton accounts={ONE_ACCOUNT} />);

    await openAndFill(user, { to: "not-an-email" });
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText(/invalid address/i)).toBeInTheDocument();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  test("action failure shows the error and PRESERVES the draft", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({
      ok: false,
      error: "Gmail rejected the send (HTTP 429). Your draft is untouched.",
    });
    render(<ComposeEmailButton accounts={ONE_ACCOUNT} />);

    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(
      await screen.findByText(/gmail rejected the send/i)
    ).toBeInTheDocument();
    // Every field keeps what was typed.
    expect(field("to").value).toBe("alice@example.com");
    expect(field("subject").value).toBe("Retainer");
    expect(field("body").value).toBe("Hi Alice");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("success closes the dialog, clears the draft, refreshes the list", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(<ComposeEmailButton accounts={ONE_ACCOUNT} />);

    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("New email")).not.toBeInTheDocument()
    );

    // Reopen: the draft is gone (it was sent, not stashed).
    await user.click(screen.getByRole("button", { name: /compose/i }));
    await screen.findByText("New email");
    expect(field("to").value).toBe("");
    expect(field("body").value).toBe("");
  });

  test("Send stays disabled without a recipient or body", async () => {
    const user = setupUser();
    render(<ComposeEmailButton accounts={ONE_ACCOUNT} />);

    await user.click(screen.getByRole("button", { name: /compose/i }));
    await screen.findByText("New email");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();

    await user.type(field("to"), "alice@example.com");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();

    await user.type(field("body"), "Hi");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeEnabled();
  });
});
