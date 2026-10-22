/**
 * GenerateFromTemplateDialog — preview, warnings, copy/save paths.
 *
 * Server actions are mocked; the dialog's own state machine is what
 * is under test: preview + missing/unknown banners after picking a
 * template, Save gated on canUpload, {ok:false} -> error banner, a
 * clipboard failure surfacing an error instead of a silent no-op,
 * save confirming by name (the file lands at the matter root), and
 * per-open reset.
 *
 * Dialog content mounts in a portal, so everything queries `screen`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const previewMock = vi.fn();
const generateMock = vi.fn();
vi.mock("@/app/actions/document-templates", () => ({
  previewDocumentFromTemplate: (...a: unknown[]) => previewMock(...a),
  generateDocumentFromTemplate: (...a: unknown[]) => generateMock(...a),
}));

import { GenerateFromTemplateDialog } from "./generate-from-template-dialog";

const TEMPLATES = [
  { id: "t1", name: "Demand letter", category: "demand_letter", description: null },
  { id: "t2", name: "Intake memo", category: "intake", description: "Odd category" },
];
const TEAM = [
  { id: "u1", name: "Me Attorney" },
  { id: "u2", name: "Zed Paralegal" },
];
const CONTACTS = [{ id: "c1", name: "Pat Counsel", role: "opposing counsel" }];
const M1 = { kind: "matter", matterId: "m1" } as const;

const okPreview = (over: Record<string, unknown> = {}) => ({
  ok: true,
  templateName: "Demand letter",
  text: "Dear Maria Alvarez,",
  html: "<p>Dear Maria Alvarez,</p>",
  report: { missing: [], invalid: [], archivedBlocks: [] },
  templateUpdatedAt: "2026-10-22T00:00:00.000Z",
  needsSigner: false,
  needsRecipient: false,
  ...over,
});

async function openAndPick(user: ReturnType<typeof userEvent.setup>, templateId = "t1") {
  await user.click(screen.getByRole("button", { name: /generate from template/i }));
  await user.selectOptions(screen.getByLabelText("Template"), templateId);
}

beforeEach(() => {
  previewMock.mockReset();
  generateMock.mockReset();
});

describe("GenerateFromTemplateDialog", () => {
  it("shows the merged preview with missing + unknown field warnings", async () => {
    previewMock.mockResolvedValue(
      okPreview({
        report: { missing: ["client.phone"], invalid: ["made.up"], archivedBlocks: [] },
      }),
    );
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload
      />,
    );
    await openAndPick(user);

    expect(await screen.findByText("Dear Maria Alvarez,")).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledWith("t1", { kind: "matter", matterId: "m1" });
    expect(screen.getByText(/Missing:/)).toHaveTextContent("client.phone");
    expect(screen.getByText(/don.t apply here/)).toHaveTextContent("made.up");
  });

  it("groups non-curated categories under their raw label", async () => {
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload
      />,
    );
    await user.click(screen.getByRole("button", { name: /generate from template/i }));
    expect(screen.getByRole("group", { name: "Demand letters" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "intake" })).toBeInTheDocument();
  });

  it("hides Save when the viewer lacks documents.upload (copy stays)", async () => {
    previewMock.mockResolvedValue(okPreview());
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload={false}
      />,
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    expect(screen.queryByRole("button", { name: /save to documents/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy text/i })).toBeEnabled();
  });

  it("shows the action's error when saving fails and keeps the dialog open", async () => {
    previewMock.mockResolvedValue(okPreview());
    generateMock.mockResolvedValue({ ok: false, error: "Storage is down." });
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload
      />,
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    await user.click(screen.getByRole("button", { name: /save to documents/i }));

    expect(await screen.findByText("Storage is down.")).toBeInTheDocument();
    expect(screen.getByText("Dear Maria Alvarez,")).toBeInTheDocument();
  });

  it("on a lead the save confirmation names the intake, not the matter", async () => {
    previewMock.mockResolvedValue(okPreview());
    generateMock.mockResolvedValue({
      ok: true,
      documentId: "d1",
      documentName: "Demand letter.docx",
      report: { missing: [], invalid: [], archivedBlocks: [] },
    });
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "lead", leadId: "l1" }}
        templates={TEMPLATES}
        canUpload
      />,
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    await user.click(screen.getByRole("button", { name: /save to documents/i }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/intake's root list/);
    expect(status).not.toHaveTextContent(/matter/);
  });

  it("confirms a successful save by document name instead of closing silently", async () => {
    previewMock.mockResolvedValue(okPreview());
    generateMock.mockResolvedValue({
      ok: true,
      documentId: "d1",
      documentName: "Demand letter — Apr 15, 2026.docx",
      report: { missing: [], invalid: [], archivedBlocks: [] },
    });
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload
      />,
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    await user.click(screen.getByRole("button", { name: /save to documents/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Demand letter — Apr 15, 2026.docx");
    expect(status).toHaveTextContent(/All documents/);
    // Can't double-save the same preview into a duplicate.
    expect(screen.queryByRole("button", { name: /save to documents/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("surfaces a clipboard failure instead of failing silently", async () => {
    previewMock.mockResolvedValue(okPreview());
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload
      />,
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");

    // userEvent.setup() installs its own clipboard stub; override it
    // so writeText rejects like a permission-denied browser.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await user.click(screen.getByRole("button", { name: /copy text/i }));

    expect(await screen.findByText(/Couldn.t copy/)).toBeInTheDocument();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("copies the merged text and shows Copied on success", async () => {
    previewMock.mockResolvedValue(okPreview());
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload
      />,
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await user.click(screen.getByRole("button", { name: /copy text/i }));

    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith("Dear Maria Alvarez,");
  });

  it("starts clean on reopen (no stale preview or banners)", async () => {
    previewMock.mockResolvedValue(okPreview());
    generateMock.mockResolvedValue({ ok: false, error: "Storage is down." });
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload
      />,
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    await user.click(screen.getByRole("button", { name: /save to documents/i }));
    await screen.findByText("Storage is down.");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Storage is down.")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /generate from template/i }));
    expect(screen.queryByText("Dear Maria Alvarez,")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage is down.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Template")).toHaveValue("");
  });

  it("with a records request: preselects the default template and passes the request id", async () => {
    previewMock.mockResolvedValue(okPreview());
    generateMock.mockResolvedValue({ ok: true, documentName: "Letter.md" });
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload
        recordsRequestId="rr1"
        defaultTemplateId="t2"
        triggerLabel="Generate letter"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Generate letter" }));
    expect(await screen.findByText("Dear Maria Alvarez,")).toBeInTheDocument();
    expect(screen.getByLabelText("Template")).toHaveValue("t2");
    expect(previewMock).toHaveBeenCalledWith(
      "t2",
      { kind: "matter", matterId: "m1" },
      { recordsRequestId: "rr1" },
    );
    await user.click(screen.getByRole("button", { name: /save to documents/i }));
    await screen.findByText("Letter.md");
    expect(generateMock).toHaveBeenCalledWith(
      "t2",
      { kind: "matter", matterId: "m1" },
      { recordsRequestId: "rr1", expectedUpdatedAt: "2026-10-22T00:00:00.000Z" },
    );
  });

  it("ignores a default template that is no longer offered", async () => {
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "matter", matterId: "m1" }}
        templates={TEMPLATES}
        canUpload
        defaultTemplateId="gone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /generate from template/i }));
    expect(screen.getByLabelText("Template")).toHaveValue("");
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("hides email/sms and wrong-scope templates", async () => {
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={{ kind: "lead", leadId: "l1" }}
        templates={[
          { ...TEMPLATES[0]!, kind: "letter", appliesTo: "both" },
          {
            id: "t3",
            name: "Matter only",
            category: "general",
            description: null,
            kind: "letter",
            appliesTo: "matter",
          },
          {
            id: "t4",
            name: "An email",
            category: "general",
            description: null,
            kind: "email",
            appliesTo: "both",
          },
          {
            id: "t5",
            name: "A text",
            category: "general",
            description: null,
            kind: "sms",
            appliesTo: "lead",
          },
        ]}
        canUpload
      />,
    );
    await user.click(screen.getByRole("button", { name: /generate from template/i }));
    expect(screen.getByRole("option", { name: "Demand letter" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Matter only" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "An email" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "A text" })).not.toBeInTheDocument();
  });

  it("shows signer and recipient selects only when the preview needs them", async () => {
    previewMock.mockResolvedValue(okPreview());
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={M1}
        templates={TEMPLATES}
        canUpload
        team={TEAM}
        contacts={CONTACTS}
        currentUserId="u1"
      />,
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    expect(screen.queryByLabelText("Signer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Recipient")).not.toBeInTheDocument();

    previewMock.mockResolvedValue(okPreview({ needsSigner: true, needsRecipient: true }));
    await user.selectOptions(screen.getByLabelText("Template"), "t2");
    expect(await screen.findByLabelText("Signer")).toHaveValue("u1");
    expect(screen.getByLabelText("Recipient")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Pat Counsel — opposing counsel" }),
    ).toBeInTheDocument();
  });

  it("changing signer or recipient re-runs the preview with the choice", async () => {
    previewMock.mockResolvedValue(okPreview({ needsSigner: true, needsRecipient: true }));
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={M1}
        templates={TEMPLATES}
        canUpload
        team={TEAM}
        contacts={CONTACTS}
        currentUserId="u1"
      />,
    );
    await openAndPick(user);
    await user.selectOptions(await screen.findByLabelText("Signer"), "u2");
    await waitFor(() => expect(previewMock).toHaveBeenLastCalledWith("t1", M1, { signerId: "u2" }));
    await user.selectOptions(screen.getByLabelText("Recipient"), "c1");
    await waitFor(() =>
      expect(previewMock).toHaveBeenLastCalledWith("t1", M1, {
        signerId: "u2",
        recipientContactId: "c1",
      }),
    );
  });

  it("save sends folderId, signer, recipient and expectedUpdatedAt", async () => {
    previewMock.mockResolvedValue(okPreview({ needsSigner: true, needsRecipient: true }));
    generateMock.mockResolvedValue({ ok: true, documentId: "d1", documentName: "X.docx" });
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        scope={M1}
        templates={TEMPLATES}
        canUpload
        folderId="f1"
        team={TEAM}
        contacts={CONTACTS}
        currentUserId="u1"
      />,
    );
    await openAndPick(user);
    await user.selectOptions(await screen.findByLabelText("Recipient"), "c1");
    await user.click(screen.getByRole("button", { name: /save to documents/i }));
    await screen.findByRole("status");
    expect(generateMock).toHaveBeenCalledWith("t1", M1, {
      folderId: "f1",
      signerId: "u1",
      recipientContactId: "c1",
      expectedUpdatedAt: "2026-10-22T00:00:00.000Z",
    });
  });

  it("on a stale refusal re-runs the preview and shows the copy above it", async () => {
    previewMock.mockResolvedValueOnce(okPreview());
    previewMock.mockResolvedValueOnce(
      okPreview({ html: "<p>Newer text</p>", templateUpdatedAt: "2026-10-23T00:00:00.000Z" }),
    );
    generateMock.mockResolvedValue({
      ok: false,
      error: "This template changed — review the preview again.",
    });
    const user = userEvent.setup();
    render(<GenerateFromTemplateDialog scope={M1} templates={TEMPLATES} canUpload />);
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    await user.click(screen.getByRole("button", { name: /save to documents/i }));
    expect(await screen.findByText("Newer text")).toBeInTheDocument();
    expect(screen.getByText(/This template changed/)).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledTimes(2);
  });

  it("lists archived blocks in the report", async () => {
    previewMock.mockResolvedValue(
      okPreview({ report: { missing: [], invalid: [], archivedBlocks: ["Old footer"] } }),
    );
    const user = userEvent.setup();
    render(<GenerateFromTemplateDialog scope={M1} templates={TEMPLATES} canUpload />);
    await openAndPick(user);
    expect(await screen.findByText(/Archived blocks:/)).toHaveTextContent("Old footer");
  });
});
