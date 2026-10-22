/**
 * Full-page template / block editor: save payload and versioning, the
 * applies-to fit check, the SMS counter, the legacy-conversion notice,
 * the mobile read-only view and block usage. Actions are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveTemplate = vi.fn();
const saveBlock = vi.fn();
const previewDraft = vi.fn();
const searchRecords = vi.fn();
const refresh = vi.fn();
const replace = vi.fn();

vi.mock("@/app/actions/document-templates", () => ({
  saveDocumentTemplate: (...a: unknown[]) => saveTemplate(...a),
  previewTemplateDraft: (...a: unknown[]) => previewDraft(...a),
  searchTemplatePreviewRecords: (...a: unknown[]) => searchRecords(...a),
}));
vi.mock("@/app/actions/template-blocks", () => ({
  saveTemplateBlock: (...a: unknown[]) => saveBlock(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace, push: vi.fn() }),
}));

import { TemplateEditorPage, type EditorTemplate } from "./template-editor-page";

function mockViewport(desktop: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: desktop,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }) as unknown as MediaQueryList,
  );
}

const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });
const field = (path: string) => ({ type: "field", attrs: { path, format: null } });

const UPDATED = "2026-10-01T12:00:00.000Z";

const tpl = (over: Partial<EditorTemplate> = {}): EditorTemplate => ({
  id: "t1",
  name: "Demand letter",
  category: "demand_letter",
  description: null,
  kind: "letter",
  appliesTo: "matter",
  content: { type: "doc", content: [para(text("Hello "), field("matter.caseNumber"))] } as never,
  body: null,
  subject: null,
  updatedAt: UPDATED,
  ...over,
});

beforeEach(() => {
  mockViewport(true);
  saveTemplate.mockReset();
  saveBlock.mockReset();
  previewDraft.mockReset();
  searchRecords.mockReset().mockResolvedValue([]);
  refresh.mockReset();
  replace.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const saveButton = () => screen.getByRole("button", { name: "Save" });

describe("TemplateEditorPage — templates", () => {
  it("saves editor JSON with expectedUpdatedAt, then sends the returned version", async () => {
    const user = userEvent.setup();
    saveTemplate
      .mockResolvedValueOnce({ ok: true, id: "t1", updatedAt: "2026-10-02T00:00:00.000Z" })
      .mockResolvedValueOnce({ ok: true, id: "t1", updatedAt: "2026-10-03T00:00:00.000Z" });
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    await waitFor(() => expect(document.querySelector("[data-field-chip]")).not.toBeNull());

    await user.click(saveButton());
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledTimes(1));
    const payload = saveTemplate.mock.calls[0]![0];
    expect(payload).toMatchObject({
      id: "t1",
      name: "Demand letter",
      category: "demand_letter",
      kind: "letter",
      appliesTo: "matter",
      expectedUpdatedAt: UPDATED,
    });
    expect(payload.content.type).toBe("doc");
    expect(JSON.stringify(payload.content)).toContain('"path":"matter.caseNumber"');

    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    await user.click(saveButton());
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledTimes(2));
    expect(saveTemplate.mock.calls[1]![0].expectedUpdatedAt).toBe("2026-10-02T00:00:00.000Z");
  });

  it("a stale save shows the error with a Reload action", async () => {
    const user = userEvent.setup();
    saveTemplate.mockResolvedValue({
      ok: false,
      error: "Someone else saved this template — reload to see their changes.",
    });
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    await user.click(saveButton());
    expect(
      await screen.findByText("Someone else saved this template — reload to see their changes."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("switching applies-to to lead flags the matter-only chip and blocks Save", async () => {
    const user = userEvent.setup();
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    await waitFor(() => expect(document.querySelector("[data-field-chip]")).not.toBeNull());
    expect(saveButton()).not.toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Applies to"), "lead");
    expect(
      await screen.findByText("Remove or replace the highlighted fields to save."),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    await waitFor(() => expect(document.querySelector("[data-fit-invalid]")).not.toBeNull());
  });

  it("sms shows characters and segments counted with sample values", async () => {
    render(
      <TemplateEditorPage
        template={tpl({
          kind: "sms",
          content: { type: "doc", content: [para(text("a".repeat(161)))] } as never,
        })}
        blocks={[]}
        canSave
      />,
    );
    expect(await screen.findByText("161 characters · 2 segments")).toBeInTheDocument();
    expect(screen.getByText("Counted with sample values")).toBeInTheDocument();
  });

  it("converts a legacy body and says so", async () => {
    render(
      <TemplateEditorPage
        template={tpl({ content: null, body: "Dear {{client.name}}," })}
        blocks={[]}
        canSave
      />,
    );
    expect(
      screen.getByText("Converted from the old text format — review and save."),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector("[data-field-chip]")).not.toBeNull());
  });

  it("below desktop shows the sample preview only", () => {
    mockViewport(false);
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    expect(screen.getByText("Edit on a larger screen.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByTestId("template-preview").textContent).toContain("Hello 2026-CV-00000");
  });

  it("changing kind to text message keeps the text", async () => {
    const user = userEvent.setup();
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    await waitFor(() => expect(document.querySelector("[data-field-chip]")).not.toBeNull());
    await user.selectOptions(screen.getByLabelText("Kind"), "sms");
    expect(await screen.findByText(/characters · /)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Template body").textContent).toContain("Hello"),
    );
    expect(document.querySelector("[data-field-chip]")).not.toBeNull();
  });

  it("previews against a real record picked from the search", async () => {
    const user = userEvent.setup();
    searchRecords.mockResolvedValue([
      { scope: { kind: "matter", matterId: "m1" }, label: "Alvarez v. Aurora" },
    ]);
    previewDraft.mockResolvedValue({
      ok: true,
      html: "<p>Hello 2026-CV-00481</p>",
      text: "Hello 2026-CV-00481",
      subjectText: null,
      report: { missing: ["Court"], invalid: [], archivedBlocks: [] },
    });
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    await user.click(screen.getByRole("button", { name: "Preview with a real matter or lead" }));
    await user.type(screen.getByLabelText("Search for a matter"), "alv");
    await user.click(await screen.findByRole("button", { name: /Alvarez v. Aurora/ }));
    expect(searchRecords).toHaveBeenCalledWith("alv", "matter");
    await waitFor(() =>
      expect(screen.getByTestId("template-preview").textContent).toContain("2026-CV-00481"),
    );
    expect(previewDraft.mock.calls[0]![0]).toMatchObject({
      kind: "letter",
      appliesTo: "matter",
      target: { scope: { kind: "matter", matterId: "m1" } },
    });
    expect(screen.getByText("Not on file: Court")).toBeInTheDocument();
  });

  it("without the key the page is read-only", () => {
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave={false} />);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
  });
});

describe("TemplateEditorPage — blocks", () => {
  it("lists the templates that use the block", () => {
    render(
      <TemplateEditorPage
        block={{
          id: "b1",
          key: "signature",
          name: "Signature",
          description: null,
          content: { type: "doc", content: [para(text("Sincerely"))] } as never,
          updatedAt: UPDATED,
        }}
        usage={[
          { id: "t1", name: "Demand letter" },
          { id: "t2", name: "Retainer" },
        ]}
        canSave
      />,
    );
    expect(screen.getByText("Used by 2 templates")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Demand letter" })).toHaveAttribute(
      "href",
      "/settings/templates/t1",
    );
    expect(screen.getByRole("link", { name: "Retainer" })).toHaveAttribute(
      "href",
      "/settings/templates/t2",
    );
  });

  it("saves the block with its version", async () => {
    const user = userEvent.setup();
    saveBlock.mockResolvedValue({ ok: true, id: "b1", updatedAt: "2026-10-02T00:00:00.000Z" });
    render(
      <TemplateEditorPage
        block={{
          id: "b1",
          key: "signature",
          name: "Signature",
          description: null,
          content: { type: "doc", content: [para(text("Sincerely"))] } as never,
          updatedAt: UPDATED,
        }}
        usage={[]}
        canSave
      />,
    );
    await user.click(saveButton());
    await waitFor(() => expect(saveBlock).toHaveBeenCalled());
    expect(saveBlock.mock.calls[0]![0]).toMatchObject({
      id: "b1",
      key: "signature",
      name: "Signature",
      expectedUpdatedAt: UPDATED,
    });
  });
});
