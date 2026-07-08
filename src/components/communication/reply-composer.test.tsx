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
}) {
  return render(
    <ReplyComposer
      threadId="t1"
      accountEmail="me@firm.com"
      reply={over?.reply ?? REPLY}
      replyAll={over?.replyAll ?? REPLY_ALL}
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
  test("expanding Reply shows the derived recipient read-only, sends without overrides", async () => {
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
    expect(payload.to).toBeUndefined(); // unedited → server derives
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
});
