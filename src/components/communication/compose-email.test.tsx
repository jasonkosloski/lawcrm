/**
 * ComposeEmailButton tests — account-picker states (none / one /
 * several), client-side address validation, action wiring (rich
 * HTML body + htmlToText downgrade), and the draft-preservation
 * contract on send failure.
 *
 * Server action + router are mocked at module level per the house
 * pattern (docs/TESTING.md layer 2). Inputs are queried by [name]
 * (the form primitives don't htmlFor-associate labels).
 *
 * The shared RichTextEditor is mocked: Tiptap/ProseMirror needs
 * real contenteditable + Selection APIs that happy-dom lacks. The
 * stub preserves the editor's exact contract — uncontrolled after
 * mount, seeded from `initialHTML`, emits an HTML string via
 * `onChange` — so everything the composer owns (state, wiring,
 * downgrade, draft preservation) is tested for real.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ComposeEmailButton } from "./compose-email";

vi.mock("@/app/actions/email-send", () => ({
  sendEmail: vi.fn(),
  replyToThread: vi.fn(),
}));

vi.mock("@/components/shared/rich-text-editor", () => ({
  RichTextEditor: ({
    initialHTML,
    onChange,
    placeholder,
  }: {
    initialHTML?: string;
    onChange: (html: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      name="body"
      defaultValue={initialHTML ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// next/link renders fine in happy-dom, but keep it a plain anchor so
// the no-account state can assert on href without router context.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/feedback", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

import { sendEmail } from "@/app/actions/email-send";
import { notifySuccess } from "@/lib/feedback";
const mockedSendEmail = vi.mocked(sendEmail);
const MATTERS = [
  { id: "m1", name: "Smith v. Jones", color: "#123456", area: "PI", isPinned: false },
  { id: "m2", name: "Estate of Doe", color: "#654321", area: "EP", isPinned: false },
];
const LEADS = [{ id: "l1", name: "Pat Lead", stage: "new" }];
const SCOPE = { kind: "matter", matterId: "m1" } as const;

// Base UI toggles pointer-events during popup animation; happy-dom's
// computed-style check trips on it (see follow-up-button.test.tsx).
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

const ONE_ACCOUNT = [{ id: "acc-1", emailAddress: "me@firm.com" }];
const TWO_ACCOUNTS = [
  { id: "acc-1", emailAddress: "me@firm.com" },
  { id: "acc-2", emailAddress: "litigation@firm.com" },
];

const field = (name: string): HTMLInputElement | HTMLTextAreaElement =>
  document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;

async function openAndFill(user: ReturnType<typeof setupUser>, over?: { to?: string }) {
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
    render(<ComposeEmailButton accounts={[]} matters={MATTERS} leads={LEADS} />);
    // happy-dom trap: the Base UI render-prop anchor doesn't expose
    // an accessible name to getByRole here — query by text + closest.
    const link = screen.getByText(/connect gmail/i).closest("a");
    expect(link).toHaveAttribute("href", "/settings/integrations");
    expect(screen.queryByRole("button", { name: /compose/i })).not.toBeInTheDocument();
  });

  test("single account → no From picker, sends from it", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    expect(document.querySelector('[name="accountId"]')).toBeNull();

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(mockedSendEmail).toHaveBeenCalledWith("acc-1", {
        to: ["alice@example.com"],
        cc: [],
        subject: "Retainer",
        // The stub editor emits its raw value as HTML; plain words
        // downgrade to themselves.
        bodyText: "Hi Alice",
        bodyHtml: "Hi Alice",
        scope: SCOPE,
        attachmentDocumentIds: [],
      }),
    );
  });

  test("rich body round-trip: editor HTML up as bodyHtml, htmlToText as bodyText", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    const richHtml =
      '<p>Hi <strong>Alice</strong>,</p><p>Next steps:</p><ul><li><p>Sign the <a href="https://firm.com/retainer">retainer</a></p></li><li><p>Send documents</p></li></ul>';
    fireEvent.change(field("body"), { target: { value: richHtml } });

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(mockedSendEmail).toHaveBeenCalledWith(
        "acc-1",
        expect.objectContaining({
          bodyHtml: richHtml, // raw — sanitizing is the action's job
          bodyText:
            "Hi Alice,\n\nNext steps:\n\n- Sign the retainer (https://firm.com/retainer)\n- Send documents",
        }),
      ),
    );
  });

  test("multiple accounts → From picker, chosen account is used", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(
      <ComposeEmailButton
        accounts={TWO_ACCOUNTS}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    const picker = document.querySelector('[name="accountId"]') as HTMLSelectElement;
    expect(picker).not.toBeNull();
    await user.selectOptions(picker, "acc-2");

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(mockedSendEmail).toHaveBeenCalledWith(
        "acc-2",
        expect.objectContaining({ to: ["alice@example.com"] }),
      ),
    );
  });
});

describe("ComposeEmailButton — stale From account", () => {
  test("when the chosen account drops out of `accounts`, Send uses a live one", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    const { rerender } = render(
      <ComposeEmailButton
        accounts={TWO_ACCOUNTS}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );
    await user.click(screen.getByRole("button", { name: /compose/i }));
    await screen.findByText("New email");
    // Default is acc-1; its grant then fails and the launcher
    // re-filters it out while this component stays mounted.
    rerender(
      <ComposeEmailButton
        accounts={[{ id: "acc-2", emailAddress: "litigation@firm.com" }]}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );
    await user.type(field("to"), "alice@example.com");
    await user.type(field("body"), "Hi");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(mockedSendEmail).toHaveBeenCalledWith("acc-2", expect.anything()));
  });
});

describe("ComposeEmailButton — validation + draft preservation", () => {
  test("invalid To address blocks the send with an inline error", async () => {
    const user = setupUser();
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

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
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText(/gmail rejected the send/i)).toBeInTheDocument();
    // Every field keeps what was typed.
    expect(field("to").value).toBe("alice@example.com");
    expect(field("subject").value).toBe("Retainer");
    expect(field("body").value).toBe("Hi Alice");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("success closes the dialog, clears the draft, refreshes the list", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("New email")).not.toBeInTheDocument());

    // Reopen: the draft is gone (it was sent, not stashed).
    await user.click(screen.getByRole("button", { name: /compose/i }));
    await screen.findByText("New email");
    expect(field("to").value).toBe("");
    expect(field("body").value).toBe("");
  });

  test("a REJECTED send keeps the draft and shows a check-Sent message (no throw)", async () => {
    const user = setupUser();
    mockedSendEmail.mockRejectedValue(new Error("Failed to persist sent thread"));
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText(/couldn't confirm the send/i)).toBeInTheDocument();
    expect(field("to").value).toBe("alice@example.com");
    expect(field("body").value).toBe("Hi Alice");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("Enter in To / Cc / Subject does NOT send the email", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    await user.type(screen.getByLabelText("Cc"), "bob@example.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), " v2{Enter}");
    await user.type(screen.getByLabelText("To"), "{Enter}");

    expect(mockedSendEmail).not.toHaveBeenCalled();
    // The explicit Send button still sends.
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(mockedSendEmail).toHaveBeenCalledTimes(1));
  });

  test("Cancel is disabled and Esc is ignored while sending", async () => {
    const user = setupUser();
    let settle!: (v: { ok: false; error: string }) => void;
    mockedSendEmail.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(await screen.findByRole("button", { name: /sending/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.getByText("New email")).toBeInTheDocument();

    // The failure is visible because the dialog is still open.
    settle({ ok: false, error: "Gmail rejected the send (HTTP 429)." });
    expect(await screen.findByText(/HTTP 429/)).toBeInTheDocument();
  });

  test("To, Cc and Subject carry persistent accessible labels", async () => {
    const user = setupUser();
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );
    await openAndFill(user);
    expect(screen.getByLabelText("To")).toHaveValue("alice@example.com");
    expect(screen.getByLabelText("Cc")).toHaveValue("");
    expect(screen.getByLabelText("Subject")).toHaveValue("Retainer");
  });

  test("Send stays disabled without a recipient or body", async () => {
    const user = setupUser();
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await user.click(screen.getByRole("button", { name: /compose/i }));
    await screen.findByText("New email");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();

    await user.type(field("to"), "alice@example.com");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();

    await user.type(field("body"), "Hi");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeEnabled();
  });

  test("empty-document scaffolding (<p></p>) keeps Send disabled", async () => {
    const user = setupUser();
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await user.click(screen.getByRole("button", { name: /compose/i }));
    await screen.findByText("New email");
    await user.type(field("to"), "alice@example.com");
    // An emptied Tiptap document is tags without text.
    fireEvent.change(field("body"), { target: { value: "<p></p>" } });
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });
});

describe("ComposeEmailButton - required record", () => {
  test("Send stays disabled until a record is chosen; picking one enables it and posts the scope", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(<ComposeEmailButton accounts={ONE_ACCOUNT} matters={MATTERS} leads={LEADS} />);

    await openAndFill(user);
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /pat lead/i }));
    expect(screen.getByRole("button", { name: /^send$/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(mockedSendEmail).toHaveBeenCalledWith(
        "acc-1",
        expect.objectContaining({ scope: { kind: "lead", leadId: "l1" } }),
      ),
    );
  });

  test("initialScope prefills the record and stays editable", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({ ok: true, threadId: "t1" });
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    expect(screen.getByText("Matter or lead")).toBeVisible();
    expect(screen.getByRole("group", { name: "Matter or lead" })).toBeInTheDocument();
    expect(screen.getByTestId("compose-record")).toHaveTextContent("Smith v. Jones");
    await user.click(screen.getByRole("button", { name: /change/i }));
    await user.click(screen.getByRole("button", { name: /estate of doe/i }));
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(mockedSendEmail).toHaveBeenCalledWith(
        "acc-1",
        expect.objectContaining({ scope: { kind: "matter", matterId: "m2" } }),
      ),
    );
  });

  test("a success notice is shown after the draft clears, and the record resets to initialScope", async () => {
    const user = setupUser();
    mockedSendEmail.mockResolvedValue({
      ok: true,
      threadId: "t1",
      notice: "Added to an existing thread filed to Estate of Doe.",
    });
    render(
      <ComposeEmailButton
        accounts={ONE_ACCOUNT}
        matters={MATTERS}
        leads={LEADS}
        initialScope={SCOPE}
      />,
    );

    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /change/i }));
    await user.click(screen.getByRole("button", { name: /estate of doe/i }));
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith(
        "Added to an existing thread filed to Estate of Doe.",
      ),
    );
    await user.click(screen.getByRole("button", { name: /compose/i }));
    await screen.findByText("New email");
    expect(field("to").value).toBe("");
    expect(screen.getByTestId("compose-record")).toHaveTextContent("Smith v. Jones");
  });
});
