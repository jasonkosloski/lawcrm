/**
 * Full-page template / block editor: save payload and versioning, the
 * applies-to fit check, the SMS counter, the legacy-conversion notice,
 * the mobile read-only view and block usage. Actions are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
import { DEFAULT_DOCUMENT_STYLE, resolvePageStyle } from "@/lib/templates/page-style";

let viewport = { desktop: true, listeners: new Set<() => void>() };

/** Stub matchMedia; `resize(false)` narrows the window and notifies. */
function mockViewport(desktop: boolean) {
  viewport = { desktop, listeners: new Set() };
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        get matches() {
          return viewport.desktop;
        },
        media: query,
        addEventListener: (_: string, cb: () => void) => viewport.listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => viewport.listeners.delete(cb),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }) as unknown as MediaQueryList,
  );
}

function resize(desktop: boolean) {
  act(() => {
    viewport.desktop = desktop;
    for (const cb of viewport.listeners) cb();
  });
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

  it("warns about styles that no longer exist without blocking Save", async () => {
    const content = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { style: "gone" }, content: [text("Hi")] }],
    } as never;
    render(<TemplateEditorPage template={tpl({ content })} blocks={[]} canSave />);
    expect(await screen.findByText(/Styles that no longer exist/)).toHaveTextContent("gone");
    expect(saveButton()).not.toBeDisabled();
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
      expect(screen.getByRole("textbox", { name: "Template body" }).textContent).toContain("Hello"),
    );
    expect(screen.getByRole("group", { name: "Template body" })).toBeInTheDocument();
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
      report: { missing: ["Court"], blank: [], invalid: [], archivedBlocks: [], unknownStyles: [] },
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

  const PAGE_STYLE = {
    values: { ...DEFAULT_DOCUMENT_STYLE, letterheadBlockId: "lh", logoPosition: "right" as const },
    logo: { position: "right" as const },
    logoUrl: "/api/document-style/logo?v=1",
  };
  const LH_BLOCK = {
    id: "lh",
    name: "Letterhead",
    isActive: true,
    content: {
      type: "doc",
      content: [para(text("FIRM HEAD "), field("matter.caseNumber"))],
    } as never,
  };

  it("letters preview as a styled page with the firm letterhead and logo (sample data)", () => {
    render(
      <TemplateEditorPage template={tpl()} blocks={[LH_BLOCK]} pageStyle={PAGE_STYLE} canSave />,
    );
    const page = screen.getByTestId("page-preview");
    expect(screen.getByTestId("template-preview")).toContainElement(page);
    expect(page.querySelector("[data-page-letterhead]")?.textContent).toBe(
      "FIRM HEAD 2026-CV-00000",
    );
    expect(page.querySelector("img")?.getAttribute("src")).toBe("/api/document-style/logo?v=1");
    expect(page.querySelector("[data-page-body]")?.textContent).toContain("Hello 2026-CV-00000");
  });

  it("text messages keep the plain preview even with a page style", async () => {
    const user = userEvent.setup();
    render(<TemplateEditorPage template={tpl()} blocks={[]} pageStyle={PAGE_STYLE} canSave />);
    await user.selectOptions(screen.getByLabelText("Kind"), "sms");
    expect(screen.queryByTestId("page-preview")).not.toBeInTheDocument();
  });

  it("a real-record preview renders the page the action returns", async () => {
    const user = userEvent.setup();
    searchRecords.mockResolvedValue([
      { scope: { kind: "matter", matterId: "m1" }, label: "Alvarez v. Aurora" },
    ]);
    previewDraft.mockResolvedValue({
      ok: true,
      html: "<p>Hello 2026-CV-00481</p>",
      text: "Hello 2026-CV-00481",
      subjectText: null,
      page: {
        body: { type: "doc", content: [para(text("Hello 2026-CV-00481"))] },
        letterhead: { type: "doc", content: [para(text("REAL HEAD"))] },
        continuation: null,
        style: resolvePageStyle("letter", PAGE_STYLE.values, null),
        logoUrl: null,
      },
      report: { missing: [], blank: [], invalid: [], archivedBlocks: [], unknownStyles: [] },
    });
    render(<TemplateEditorPage template={tpl()} blocks={[]} pageStyle={PAGE_STYLE} canSave />);
    await user.click(screen.getByRole("button", { name: "Preview with a real matter or lead" }));
    await user.type(screen.getByLabelText("Search for a matter"), "alv");
    await user.click(await screen.findByRole("button", { name: /Alvarez v. Aurora/ }));
    await waitFor(() =>
      expect(screen.getByTestId("page-preview").textContent).toContain("REAL HEAD"),
    );
  });

  describe("Preview as a court format", () => {
    const COURT = {
      id: "cf1",
      name: "Colorado District",
      isActive: true,
      values: {
        fontKey: null,
        fontSizeHalfPt: null,
        lineSpacing: null,
        spaceAfterPt: null,
        marginTopIn: null,
        marginRightIn: null,
        marginBottomIn: null,
        marginLeftIn: null,
        pageNumbers: null,
        paperSize: "legal" as const,
        styleOverrides: {},
      },
      replacements: [
        [
          "lh",
          {
            id: "cap",
            name: "Court caption",
            isActive: true,
            content: { type: "doc", content: [para(text("DISTRICT COURT CAPTION"))] } as never,
          },
        ],
      ] as [string, never][],
    };
    const filing = () =>
      tpl({
        kind: "filing",
        content: {
          type: "doc",
          content: [para(text("Body")), { type: "block", attrs: { blockId: "lh" } }],
        } as never,
      });
    const pane = () => screen.getByRole("combobox", { name: "Preview as" });
    const minHeight = () =>
      (screen.getByTestId("page-preview").querySelector("[data-page]") as HTMLElement).style
        .minHeight;

    it("is offered only for filings", async () => {
      const user = userEvent.setup();
      render(
        <TemplateEditorPage
          template={tpl()}
          blocks={[LH_BLOCK]}
          pageStyle={PAGE_STYLE}
          courtFormats={[COURT]}
          canSave
        />,
      );
      expect(screen.queryByLabelText("Preview as")).not.toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText("Kind"), "filing");
      expect(pane()).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "House style" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Colorado District" })).toBeInTheDocument();
    });

    it("blocks preview as a page (no letterhead) and offer Preview as, like templates", async () => {
      const user = userEvent.setup();
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
          pageStyle={PAGE_STYLE}
          courtFormats={[COURT]}
          canSave
        />,
      );
      const page = screen.getByTestId("page-preview");
      expect(page.querySelector("[data-page-body]")?.textContent).toContain("Sincerely");
      expect(page.querySelector("[data-page-letterhead]")).toBeNull();
      const before = minHeight();
      await user.selectOptions(pane(), "Colorado District");
      // Legal paper: the page grows.
      expect(minHeight()).not.toBe(before);
    });

    it("choosing a format swaps the caption and uses Legal paper; kind change resets it", async () => {
      const user = userEvent.setup();
      render(
        <TemplateEditorPage
          template={filing()}
          blocks={[LH_BLOCK]}
          pageStyle={PAGE_STYLE}
          courtFormats={[COURT]}
          canSave
        />,
      );
      const before = minHeight();
      expect(screen.getByTestId("page-preview").textContent).toContain("FIRM HEAD");
      await user.selectOptions(pane(), "cf1");
      expect(screen.getByTestId("page-preview").textContent).toContain("DISTRICT COURT CAPTION");
      expect(screen.getByTestId("page-preview").textContent).not.toContain("FIRM HEAD");
      expect(parseFloat(minHeight())).toBeGreaterThan(parseFloat(before));

      await user.selectOptions(screen.getByLabelText("Kind"), "letter");
      await user.selectOptions(screen.getByLabelText("Kind"), "filing");
      expect((pane() as HTMLSelectElement).value).toBe("");
      expect(screen.getByTestId("page-preview").textContent).toContain("FIRM HEAD");
    });

    it("a real-record preview hides the select and names the matter's court format", async () => {
      const user = userEvent.setup();
      searchRecords.mockResolvedValue([
        { scope: { kind: "matter", matterId: "m1" }, label: "Alvarez v. Aurora" },
      ]);
      previewDraft.mockResolvedValue({
        ok: true,
        html: "<p>x</p>",
        text: "x",
        subjectText: null,
        court: { name: "Colorado District", archived: false },
        page: {
          body: { type: "doc", content: [para(text("x"))] },
          letterhead: null,
          continuation: null,
          style: resolvePageStyle("filing", PAGE_STYLE.values, null),
          logoUrl: null,
        },
        report: { missing: [], blank: [], invalid: [], archivedBlocks: [], unknownStyles: [] },
      });
      render(
        <TemplateEditorPage
          template={filing()}
          blocks={[LH_BLOCK]}
          pageStyle={PAGE_STYLE}
          courtFormats={[COURT]}
          canSave
        />,
      );
      await user.click(screen.getByRole("button", { name: "Preview with a real matter or lead" }));
      await user.type(screen.getByLabelText("Search for a matter"), "alv");
      await user.click(await screen.findByRole("button", { name: /Alvarez v. Aurora/ }));
      expect(await screen.findByText("Court format: Colorado District")).toBeInTheDocument();
      expect(screen.queryByLabelText("Preview as")).not.toBeInTheDocument();
    });
  });

  it("narrowing the window keeps the editor and its unsaved edits", async () => {
    const user = userEvent.setup();
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    await waitFor(() => expect(document.querySelector("[data-field-chip]")).not.toBeNull());
    const body = screen.getByRole("textbox", { name: "Template body" });
    await user.clear(screen.getByLabelText(/^Name/));
    await user.type(screen.getByLabelText(/^Name/), "Renamed");

    resize(false);
    expect(screen.getByText("Edit on a larger screen.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    resize(true);
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Renamed");
    // Same TipTap instance: the body element was never unmounted.
    expect(screen.getByRole("textbox", { name: "Template body" })).toBe(body);
    expect(document.querySelector("[data-field-chip]")).not.toBeNull();
  });

  it("warns before unload only while there are unsaved changes", async () => {
    const user = userEvent.setup();
    saveTemplate.mockResolvedValue({ ok: true, id: "t1", updatedAt: "2026-10-02T00:00:00.000Z" });
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await user.type(screen.getByLabelText(/^Name/), "!");
    expect(unload()).toBe(true);
    await user.click(saveButton());
    await waitFor(() => expect(unload()).toBe(false));
  });

  it("Reload adopts props that already advanced before it was clicked", async () => {
    const user = userEvent.setup();
    saveTemplate.mockResolvedValue({
      ok: false,
      error: "Someone else saved this template — reload to see their changes.",
    });
    const { rerender } = render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    rerender(
      <TemplateEditorPage
        template={tpl({ name: "Their name", updatedAt: "2026-10-05T00:00:00.000Z" })}
        blocks={[]}
        canSave
      />,
    );
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Demand letter");
    await user.click(saveButton());
    await user.click(await screen.findByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByLabelText(/^Name/)).toHaveValue("Their name"));
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
  });

  it("a failed record search shows an inline error", async () => {
    const user = userEvent.setup();
    searchRecords.mockRejectedValue(new Error("boom"));
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    await user.click(screen.getByRole("button", { name: "Preview with a real matter or lead" }));
    await user.type(screen.getByLabelText("Search for a matter"), "alv");
    expect(await screen.findByText("Search failed — try again.")).toBeInTheDocument();
  });

  it("a slower, older record preview never overwrites a newer one", async () => {
    const user = userEvent.setup();
    searchRecords.mockResolvedValue([
      { scope: { kind: "matter", matterId: "m1" }, label: "First matter" },
      { scope: { kind: "matter", matterId: "m2" }, label: "Second matter" },
    ]);
    let resolveFirst: (v: unknown) => void = () => {};
    const ok = (t: string) => ({
      ok: true,
      html: `<p>${t}</p>`,
      text: t,
      subjectText: null,
      report: { missing: [], blank: [], invalid: [], archivedBlocks: [], unknownStyles: [] },
    });
    previewDraft
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(ok("SECOND"));
    render(<TemplateEditorPage template={tpl()} blocks={[]} canSave />);
    const pick = async (label: RegExp) => {
      await user.click(screen.getByRole("button", { name: "Preview with a real matter or lead" }));
      await user.type(screen.getByLabelText("Search for a matter"), "mat");
      await user.click(await screen.findByRole("button", { name: label }));
    };
    await pick(/First matter/);
    await pick(/Second matter/);
    await waitFor(() =>
      expect(screen.getByTestId("template-preview").textContent).toContain("SECOND"),
    );
    await act(async () => resolveFirst(ok("FIRST")));
    expect(screen.getByTestId("template-preview").textContent).toContain("SECOND");
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

  it("lists court formats that use the block", () => {
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
          { id: "t1", name: "Demand letter", kind: "template" },
          { id: "b2", name: "Letterhead", kind: "block" },
          { id: "f1", name: "CO District", kind: "court_format" },
        ]}
        canSave
      />,
    );
    expect(screen.getByText("Used by 1 template, 1 block and 1 court format")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Letterhead" })).toHaveAttribute(
      "href",
      "/settings/templates/blocks/b2",
    );
    expect(screen.getByRole("link", { name: "CO District" })).toHaveAttribute(
      "href",
      "/settings/court-formats/f1",
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
