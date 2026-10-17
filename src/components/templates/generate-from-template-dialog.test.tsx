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

const okPreview = (over: Record<string, unknown> = {}) => ({
  ok: true,
  templateName: "Demand letter",
  text: "Dear Maria Alvarez,",
  unresolved: [],
  missing: [],
  ...over,
});

async function openAndPick(
  user: ReturnType<typeof userEvent.setup>,
  templateId = "t1"
) {
  await user.click(
    screen.getByRole("button", { name: /generate from template/i })
  );
  await user.selectOptions(screen.getByLabelText("Template"), templateId);
}

beforeEach(() => {
  previewMock.mockReset();
  generateMock.mockReset();
});

describe("GenerateFromTemplateDialog", () => {
  it("shows the merged preview with missing + unknown field warnings", async () => {
    previewMock.mockResolvedValue(
      okPreview({ missing: ["client.phone"], unresolved: ["made.up"] })
    );
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog matterId="m1" templates={TEMPLATES} canUpload />
    );
    await openAndPick(user);

    expect(await screen.findByText("Dear Maria Alvarez,")).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledWith("t1", "m1");
    expect(screen.getByText(/Not on file for this matter/)).toHaveTextContent(
      "client.phone"
    );
    expect(screen.getByText(/Unknown fields/)).toHaveTextContent(
      "{{made.up}}"
    );
  });

  it("groups non-curated categories under their raw label", async () => {
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog matterId="m1" templates={TEMPLATES} canUpload />
    );
    await user.click(
      screen.getByRole("button", { name: /generate from template/i })
    );
    expect(screen.getByRole("group", { name: "Demand letters" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "intake" })).toBeInTheDocument();
  });

  it("hides Save when the viewer lacks documents.upload (copy stays)", async () => {
    previewMock.mockResolvedValue(okPreview());
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog
        matterId="m1"
        templates={TEMPLATES}
        canUpload={false}
      />
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    expect(
      screen.queryByRole("button", { name: /save to documents/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy text/i })).toBeEnabled();
  });

  it("shows the action's error when saving fails and keeps the dialog open", async () => {
    previewMock.mockResolvedValue(okPreview());
    generateMock.mockResolvedValue({ ok: false, error: "Storage is down." });
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog matterId="m1" templates={TEMPLATES} canUpload />
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    await user.click(screen.getByRole("button", { name: /save to documents/i }));

    expect(await screen.findByText("Storage is down.")).toBeInTheDocument();
    expect(screen.getByText("Dear Maria Alvarez,")).toBeInTheDocument();
  });

  it("confirms a successful save by document name instead of closing silently", async () => {
    previewMock.mockResolvedValue(okPreview());
    generateMock.mockResolvedValue({
      ok: true,
      documentId: "d1",
      documentName: "Demand letter — Apr 15, 2026.md",
      unresolved: [],
      missing: [],
    });
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog matterId="m1" templates={TEMPLATES} canUpload />
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    await user.click(screen.getByRole("button", { name: /save to documents/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Demand letter — Apr 15, 2026.md");
    expect(status).toHaveTextContent(/All documents/);
    // Can't double-save the same preview into a duplicate.
    expect(
      screen.queryByRole("button", { name: /save to documents/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("surfaces a clipboard failure instead of failing silently", async () => {
    previewMock.mockResolvedValue(okPreview());
    const user = userEvent.setup();
    render(
      <GenerateFromTemplateDialog matterId="m1" templates={TEMPLATES} canUpload />
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
      <GenerateFromTemplateDialog matterId="m1" templates={TEMPLATES} canUpload />
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
      <GenerateFromTemplateDialog matterId="m1" templates={TEMPLATES} canUpload />
    );
    await openAndPick(user);
    await screen.findByText("Dear Maria Alvarez,");
    await user.click(screen.getByRole("button", { name: /save to documents/i }));
    await screen.findByText("Storage is down.");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("Storage is down.")).not.toBeInTheDocument()
    );
    await user.click(
      screen.getByRole("button", { name: /generate from template/i })
    );
    expect(screen.queryByText("Dear Maria Alvarez,")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage is down.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Template")).toHaveValue("");
  });
});
