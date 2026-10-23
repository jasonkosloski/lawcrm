/**
 * ComposeEmailButton × templates — "Use template" fills subject, body
 * (signature kept) and an empty To from the picked recipient; drafts with
 * template placeholders need "Send anyway". Editor and actions are mocked
 * as in compose-email.test.tsx.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ComposeEmailButton } from "./compose-email";

vi.mock("@/app/actions/email-send", () => ({ sendEmail: vi.fn(), replyToThread: vi.fn() }));
vi.mock("@/app/actions/message-templates", () => ({
  listMessageTemplateOptions: vi.fn(),
  renderMessageTemplate: vi.fn(),
}));
vi.mock("@/components/shared/rich-text-editor", () => ({
  RichTextEditor: ({
    initialHTML,
    onChange,
  }: {
    initialHTML?: string;
    onChange: (html: string) => void;
  }) => (
    <textarea
      name="body"
      defaultValue={initialHTML ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/feedback", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import { sendEmail } from "@/app/actions/email-send";
import { listMessageTemplateOptions, renderMessageTemplate } from "@/app/actions/message-templates";

const MATTERS = [
  { id: "m1", name: "Smith v. Jones", color: "#123456", area: "PI", isPinned: false },
];
const SCOPE = { kind: "matter", matterId: "m1" } as const;
const ACCOUNTS = [{ id: "acc-1", emailAddress: "me@firm.com" }];
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });
const field = (name: string) =>
  document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;

const REPORT = { missing: [], blank: [], invalid: [], archivedBlocks: [], unknownStyles: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMessageTemplateOptions).mockResolvedValue({
    ok: true,
    templates: [{ id: "t1", name: "Status update", category: "correspondence" }],
    recipients: [
      {
        id: "c1",
        name: "Pat Counsel",
        role: "opposing counsel",
        email: "pat@law.example",
        phone: null,
      },
    ],
  });
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, threadId: "th1" });
});

async function open(user: ReturnType<typeof setupUser>, scope = true) {
  render(
    <ComposeEmailButton
      accounts={ACCOUNTS}
      matters={MATTERS}
      leads={[]}
      initialScope={scope ? SCOPE : undefined}
      signature="<p>-- Me</p>"
    />,
  );
  await user.click(screen.getByRole("button", { name: /compose/i }));
  await screen.findByText("New email");
}

describe("Use template", () => {
  test("needs a record first", async () => {
    const user = setupUser();
    await open(user, false);
    expect(screen.getByRole("button", { name: /use template/i })).toBeDisabled();
  });

  test("inserts subject, body above the signature, and the recipient's email", async () => {
    const user = setupUser();
    vi.mocked(renderMessageTemplate).mockResolvedValue({
      ok: true,
      kind: "email",
      templateName: "Status update",
      subject: "Re: Smith v. Jones",
      html: "<p>Dear Pat Counsel,</p>",
      text: "Dear Pat Counsel,",
      report: REPORT,
      needsRecipient: true,
      dropsFormatting: true,
    });
    await open(user);
    await user.click(screen.getByRole("button", { name: /use template/i }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Template" }), "t1");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Recipient" }), "c1");
    await waitFor(() =>
      expect(renderMessageTemplate).toHaveBeenLastCalledWith("t1", SCOPE, {
        recipientContactId: "c1",
      }),
    );
    expect(
      screen.getByText(/Table borders, widths and cell vertical alignment/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^insert$/i }));

    expect(field("subject").value).toBe("Re: Smith v. Jones");
    expect(field("to").value).toBe("pat@law.example");
    expect(field("body").value).toBe("<p>Dear Pat Counsel,</p><p>-- Me</p>");
  });

  test("a draft with placeholders needs Send anyway", async () => {
    const user = setupUser();
    vi.mocked(renderMessageTemplate).mockResolvedValue({
      ok: true,
      kind: "email",
      templateName: "Status update",
      subject: "Update",
      html: "<p>Dear [Recipient name — not on file],</p>",
      text: "Dear [Recipient name — not on file],",
      report: { ...REPORT, missing: ["Recipient name"] },
      needsRecipient: false,
      dropsFormatting: false,
    });
    await open(user);
    await user.type(field("to"), "x@example.com");
    await user.click(screen.getByRole("button", { name: /use template/i }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Template" }), "t1");
    expect(await screen.findByText("Missing: Recipient name")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^insert$/i }));

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/placeholders/);
    expect(sendEmail).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /send anyway/i }));
    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
  });
});

describe("Use template in a reply", () => {
  test("fills the body only — the thread's subject and recipients stay", async () => {
    const { ReplyComposer } = await import("./reply-composer");
    const user = setupUser();
    vi.mocked(renderMessageTemplate).mockResolvedValue({
      ok: true,
      kind: "email",
      templateName: "Status update",
      subject: "Ignored in replies",
      html: "<p>Thanks for your patience.</p>",
      text: "Thanks for your patience.",
      report: REPORT,
      needsRecipient: false,
      dropsFormatting: false,
    });
    render(
      <ReplyComposer
        threadId="t1"
        accountEmail="me@firm.com"
        reply={{ to: [{ name: "Alice", email: "alice@example.com" }], cc: [] }}
        replyAll={{ to: [{ name: "Alice", email: "alice@example.com" }], cc: [] }}
        needsRecord={false}
        recordScope={SCOPE}
        canFile
        matters={MATTERS}
        leads={[]}
        signature="<p>-- Me</p>"
      />,
    );
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.click(screen.getByRole("button", { name: /use template/i }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Template" }), "t1");
    await screen.findByTestId("template-preview");
    expect(screen.queryByText(/Ignored in replies/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^insert$/i }));
    expect(field("body").value).toBe("<p>Thanks for your patience.</p><p>-- Me</p>");
    expect(document.querySelector('[name="subject"]')).toBeNull();
  });
});
