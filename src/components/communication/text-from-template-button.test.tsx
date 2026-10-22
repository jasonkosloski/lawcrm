/**
 * TextFromTemplateButton — only contacts with a phone are offered; the
 * filled text shows with its segment count; Copy copies; Copy and log
 * copies then logs an outbound text filed to the matter (unfiled on a
 * lead).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/message-templates", () => ({
  listMessageTemplateOptions: vi.fn(),
  renderMessageTemplate: vi.fn(),
}));
vi.mock("@/app/actions/calls", () => ({ logText: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/feedback", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import { TextFromTemplateButton } from "./text-from-template-button";
import { listMessageTemplateOptions, renderMessageTemplate } from "@/app/actions/message-templates";
import { logText } from "@/app/actions/calls";

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMessageTemplateOptions).mockResolvedValue({
    ok: true,
    templates: [{ id: "t1", name: "Hearing reminder", category: "general" }],
    recipients: [
      { id: "c1", name: "Maria Alvarez", role: "client", email: null, phone: "(303) 555-0182" },
      { id: "c2", name: "No Phone", role: "witness", email: null, phone: null },
    ],
  });
  vi.mocked(renderMessageTemplate).mockResolvedValue({
    ok: true,
    kind: "sms",
    templateName: "Hearing reminder",
    subject: null,
    html: "",
    text: "Hi Maria, your hearing is Friday.\n",
    report: { missing: [], invalid: [], archivedBlocks: [] },
    needsRecipient: false,
    dropsFormatting: false,
  });
  vi.mocked(logText).mockResolvedValue({ ok: true });
});

async function fill(
  user: ReturnType<typeof setupUser>,
  scope: Parameters<typeof TextFromTemplateButton>[0]["scope"],
) {
  render(<TextFromTemplateButton scope={scope} />);
  await user.click(screen.getByRole("button", { name: /text from template/i }));
  await user.selectOptions(await screen.findByRole("combobox", { name: "Template" }), "t1");
  await user.selectOptions(screen.getByRole("combobox", { name: "Contact" }), "c1");
  await screen.findByTestId("text-preview");
}

describe("TextFromTemplateButton", () => {
  test("offers only contacts with a phone and shows the segment count", async () => {
    const user = setupUser();
    await fill(user, { kind: "matter", matterId: "m1" });
    const contact = screen.getByRole("combobox", { name: "Contact" });
    expect(contact).toHaveTextContent("Maria Alvarez — client");
    expect(contact).not.toHaveTextContent("No Phone");
    expect(screen.getByTestId("text-preview")).toHaveTextContent(
      "Hi Maria, your hearing is Friday.",
    );
    expect(screen.getByText(/1 segment/)).toBeInTheDocument();
  });

  test("Copy and log copies, then logs to the matter", async () => {
    const user = setupUser();
    await fill(user, { kind: "matter", matterId: "m1" });
    await user.click(screen.getByRole("button", { name: /copy and log/i }));
    await waitFor(() =>
      expect(logText).toHaveBeenCalledWith({
        contactId: "c1",
        matterId: "m1",
        body: "Hi Maria, your hearing is Friday.",
      }),
    );
    // user-event installs its own clipboard; read back what was copied.
    expect(await navigator.clipboard.readText()).toBe("Hi Maria, your hearing is Friday.");
  });

  test("on a lead the text logs unfiled", async () => {
    const user = setupUser();
    await fill(user, { kind: "lead", leadId: "l1" });
    await user.click(screen.getByRole("button", { name: /copy and log/i }));
    await waitFor(() =>
      expect(logText).toHaveBeenCalledWith(expect.objectContaining({ matterId: null })),
    );
  });
});
