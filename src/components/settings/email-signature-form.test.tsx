/**
 * Email signature card: posts the editor HTML and reports the result.
 * The shared RichTextEditor is mocked (Tiptap needs a real DOM layout).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/profile", () => ({
  updateEmailSignatureAction: vi.fn(),
}));

vi.mock("@/components/editor/rich-text-editor-lazy", () => ({
  RichTextEditor: ({
    initialHTML,
    onChange,
  }: {
    initialHTML?: string;
    onChange: (html: string) => void;
  }) => (
    <textarea
      name="signature"
      defaultValue={initialHTML ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { updateEmailSignatureAction } from "@/app/actions/profile";
import { EmailSignatureForm } from "./email-signature-form";

const mockedSave = vi.mocked(updateEmailSignatureAction);
const field = (): HTMLTextAreaElement =>
  document.querySelector('[name="signature"]') as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EmailSignatureForm", () => {
  test("starts from the stored signature and saves the edited HTML", async () => {
    const user = userEvent.setup();
    mockedSave.mockResolvedValue({ ok: true });
    render(<EmailSignatureForm signature="<p>Jane</p>" />);
    expect(field().value).toBe("<p>Jane</p>");

    await user.clear(field());
    await user.type(field(), "<p>Jane Doe</p>");
    await user.click(screen.getByRole("button", { name: /save signature/i }));

    await waitFor(() => expect(mockedSave).toHaveBeenCalledWith("<p>Jane Doe</p>"));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  test("shows the action's error", async () => {
    const user = userEvent.setup();
    mockedSave.mockResolvedValue({ ok: false, error: "Signature is too long." });
    render(<EmailSignatureForm signature={null} />);

    await user.click(screen.getByRole("button", { name: /save signature/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Signature is too long.");
  });
});
