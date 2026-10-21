/**
 * ReplyComposer tests — collapsed→expanded modes, server-derived
 * recipient prefill (read-only until Edit), reply vs reply-all
 * action wiring (overrides ONLY when edited; rich HTML body +
 * htmlToText downgrade), and the draft-preservation contract on
 * failure.
 *
 * The shared RichTextEditor is mocked (Tiptap needs real
 * contenteditable/Selection APIs happy-dom lacks) with a stub that
 * preserves its contract: uncontrolled after mount, seeded from
 * `initialHTML`, emits an HTML string via `onChange` — so the
 * composer's own state/wiring/draft logic is tested for real.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReplyComposer, type ReplyDefaults } from "./reply-composer";

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

vi.mock("@/lib/feedback", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));
import { notifySuccess } from "@/lib/feedback";
import { replyToThread } from "@/app/actions/email-send";
const mockedReply = vi.mocked(replyToThread);

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

const REPLY: ReplyDefaults = {
  to: [{ name: "Alice", email: "alice@example.com" }],
  cc: [],
};
const REPLY_ALL: ReplyDefaults = {
  to: [
    { name: "Alice", email: "alice@example.com" },
    { email: "bob@example.com" },
  ],
  cc: [{ email: "carol@example.com" }],
};

function renderComposer(over?: {
  reply?: ReplyDefaults;
  replyAll?: ReplyDefaults;
  needsRecord?: boolean;
  canFile?: boolean;
}) {
  return render(
    <ReplyComposer
      threadId="t1"
      accountEmail="me@firm.com"
      reply={over?.reply ?? REPLY}
      replyAll={over?.replyAll ?? REPLY_ALL}
      needsRecord={over?.needsRecord ?? false}
      canFile={over?.canFile ?? true}
      matters={[{ id: "m1", name: "Smith v. Jones" } as never]}
      leads={[]}
    />
  );
}

const bodyField = (): HTMLTextAreaElement =>
  document.querySelector('[name="body"]') as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReplyComposer — collapsed state", () => {
  test("shows Reply + Reply all (when reply-all adds recipients) and the from account", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: /^reply$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reply all/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/from me@firm\.com/i)).toBeInTheDocument();
  });

  test("hides Reply all when it would add nobody", () => {
    renderComposer({ replyAll: REPLY });
    expect(
      screen.queryByRole("button", { name: /reply all/i })
    ).not.toBeInTheDocument();
  });
});

describe("ReplyComposer — prefill + wiring", () => {
  test("expanding Reply shows the derived recipient read-only, posts exactly what is shown", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({ ok: true, threadId: "t1" });
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    expect(screen.getByText(/alice <alice@example\.com>/i)).toBeInTheDocument();
    // Read-only-ish: no To input until Edit recipients is toggled.
    expect(document.querySelector('[name="to"]')).toBeNull();

    await user.type(bodyField(), "Thanks!");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(mockedReply).toHaveBeenCalledWith("t1", {
        bodyText: "Thanks!",
        // The stub editor emits its raw value as HTML.
        bodyHtml: "Thanks!",
        replyAll: false,
        // F043/F064: the displayed defaults go up explicitly, flagged
        // unedited so the server can refuse if the thread moved.
        to: ["alice@example.com"],
        cc: [],
        recipientsEdited: false,
        attachmentDocumentIds: [],
      })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  test("rich body round-trip: editor HTML up as bodyHtml, htmlToText as bodyText", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({ ok: true, threadId: "t1" });
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    const richHtml =
      '<p>Thanks <em>so much</em>!</p><ol><li><p>Filed</p></li><li><p>Served — see <a href="https://court.gov/x">the order</a></p></li></ol>';
    fireEvent.change(bodyField(), { target: { value: richHtml } });
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(mockedReply).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({
          bodyHtml: richHtml, // raw — sanitizing is the action's job
          bodyText:
            "Thanks so much!\n\n1. Filed\n2. Served — see the order (https://court.gov/x)",
        })
      )
    );
  });

  test("Reply all passes replyAll: true and previews the wider list", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({ ok: true, threadId: "t1" });
    renderComposer();

    await user.click(screen.getByRole("button", { name: /reply all/i }));
    expect(screen.getByText(/bob@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/carol@example\.com/)).toBeInTheDocument();

    await user.type(bodyField(), "All hands");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(mockedReply).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ replyAll: true })
      )
    );
    const payload = mockedReply.mock.calls[0][1];
    // Unedited → the exact displayed reply-all list, flagged unedited.
    expect(payload.to).toEqual(["alice@example.com", "bob@example.com"]);
    expect(payload.cc).toEqual(["carol@example.com"]);
    expect(payload.recipientsEdited).toBe(false);
  });

  test("Edit recipients sends explicit validated overrides", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({ ok: true, threadId: "t1" });
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.click(screen.getByRole("button", { name: /edit recipients/i }));

    const to = document.querySelector('[name="to"]') as HTMLInputElement;
    expect(to.value).toBe("alice@example.com"); // prefilled from defaults
    await user.clear(to);
    await user.type(to, "dave@example.com, erin@example.com");
    await user.type(bodyField(), "Redirecting");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(mockedReply).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({
          to: ["dave@example.com", "erin@example.com"],
          cc: [],
          recipientsEdited: true,
        })
      )
    );
  });

  test("invalid edited recipient blocks the send with an inline error", async () => {
    const user = setupUser();
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.click(screen.getByRole("button", { name: /edit recipients/i }));
    const to = document.querySelector('[name="to"]') as HTMLInputElement;
    await user.clear(to);
    await user.type(to, "nope");
    await user.type(bodyField(), "x");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText(/invalid address/i)).toBeInTheDocument();
    expect(mockedReply).not.toHaveBeenCalled();
  });

  test("no derivable recipients → opens straight into edit mode", async () => {
    const user = setupUser();
    const empty: ReplyDefaults = { to: [], cc: [] };
    renderComposer({ reply: empty, replyAll: empty });

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    expect(document.querySelector('[name="to"]')).not.toBeNull();
  });
});

describe("ReplyComposer — recipient integrity (F043/F064)", () => {
  test("recipients_changed refusal keeps the draft and refreshes the page", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({
      ok: false,
      code: "recipients_changed",
      error: "New messages arrived on this thread, so the recipients changed.",
    });
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.type(bodyField(), "Privileged draft");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText(/recipients changed/i)).toBeInTheDocument();
    expect(bodyField().value).toBe("Privileged draft");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  test("other failures do not refresh", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({ ok: false, error: "Nope." });
    renderComposer();
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.type(bodyField(), "x");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(await screen.findByText("Nope.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("defaults that become empty after refresh force edit mode instead of sending nothing", async () => {
    const user = setupUser();
    const { rerender } = renderComposer();
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.type(bodyField(), "x");
    rerender(
      <ReplyComposer
        threadId="t1"
        accountEmail="me@firm.com"
        reply={{ to: [], cc: [] }}
        replyAll={{ to: [], cc: [] }}
        needsRecord={false}
        canFile
        matters={[]}
        leads={[]}
      />
    );
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(
      await screen.findByText(/add at least one recipient/i)
    ).toBeInTheDocument();
    expect(mockedReply).not.toHaveBeenCalled();
    expect(document.querySelector('[name="to"]')).not.toBeNull();
  });
});

describe("ReplyComposer — draft preservation", () => {
  test("failure surfaces the error and keeps the body", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({
      ok: false,
      error: "Google authorization was revoked — reconnect this mailbox.",
    });
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.type(bodyField(), "Long careful reply");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
    expect(bodyField().value).toBe("Long careful reply");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("switching reply → reply all keeps the typed body", async () => {
    const user = setupUser();
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.type(bodyField(), "Keep me");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await user.click(screen.getByRole("button", { name: /reply all/i }));

    expect(bodyField().value).toBe("Keep me");
  });

  test("success collapses the composer and clears the body", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({ ok: true, threadId: "t1" });
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.type(bodyField(), "Done");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Collapsed again…
    expect(
      await screen.findByRole("button", { name: /^reply$/i })
    ).toBeInTheDocument();
    // …and reopening shows a clean body.
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    expect(bodyField().value).toBe("");
  });

  test("a REJECTED send keeps the draft, shows a check-Sent message, and does not throw", async () => {
    const user = setupUser();
    mockedReply.mockRejectedValue(new Error("Failed to persist sent thread"));
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.type(bodyField(), "Careful reply");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(
      await screen.findByText(/couldn't confirm the send/i)
    ).toBeInTheDocument();
    expect(bodyField().value).toBe("Careful reply");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("Cancel is disabled while sending, so a failure can't be hidden", async () => {
    const user = setupUser();
    let settle!: (v: { ok: true; threadId: string }) => void;
    mockedReply.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.type(bodyField(), "Sending");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByRole("button", { name: /sending/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    settle({ ok: true, threadId: "t1" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("ReplyComposer — recipient fields", () => {
  test("Enter in a recipient field does NOT send the email", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({ ok: true, threadId: "t1" });
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.type(bodyField(), "Body is ready");
    await user.click(screen.getByRole("button", { name: /edit recipients/i }));
    const cc = screen.getByLabelText("Cc");
    await user.type(cc, "carol@example.com{Enter}");

    expect(mockedReply).not.toHaveBeenCalled();
  });

  test("To and Cc keep persistent labels once filled", async () => {
    const user = setupUser();
    renderComposer();

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.click(screen.getByRole("button", { name: /edit recipients/i }));
    expect(screen.getByLabelText("To")).toHaveValue("alice@example.com");
    await user.type(screen.getByLabelText("Cc"), "carol@example.com");
    expect(screen.getByLabelText("Cc")).toHaveValue("carol@example.com");
    // Visible labels, not only placeholders.
    expect(screen.getAllByText("To").length).toBeGreaterThan(0);
  });
});

describe("ReplyComposer - unfiled thread", () => {
  test("filed thread shows no record picker", async () => {
    const user = setupUser();
    renderComposer();
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    expect(screen.queryByText("Matter or lead")).not.toBeInTheDocument();
  });

  test("Send is disabled until a record is chosen, then posts the scope and shows the notice", async () => {
    const user = setupUser();
    mockedReply.mockResolvedValue({ ok: true, threadId: "t1", notice: "Filed." });
    renderComposer({ needsRecord: true });
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    expect(screen.getByText("Matter or lead")).toBeInTheDocument();
    await user.type(bodyField(), "Thanks!");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /smith v\. jones/i }));
    expect(screen.getByRole("button", { name: /^send$/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(mockedReply).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ scope: { kind: "matter", matterId: "m1" } })
      )
    );
    expect(notifySuccess).toHaveBeenCalledWith("Filed.");
  });

  test("a user who cannot file sees the message and no Send", async () => {
    const user = setupUser();
    renderComposer({ needsRecord: true, canFile: false });
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    expect(
      screen.getByText("Ask someone who can file email to file this thread first.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
  });
});
