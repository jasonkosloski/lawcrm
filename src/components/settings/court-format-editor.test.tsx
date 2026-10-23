import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const saveCourtFormat = vi.fn();
vi.mock("@/app/actions/court-formats", () => ({
  saveCourtFormat: (...a: unknown[]) => saveCourtFormat(...a),
}));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { CourtFormatEditor } from "./court-format-editor";
import { DEFAULT_DOCUMENT_STYLE } from "@/lib/templates/page-style";
import type { TemplateDoc } from "@/lib/templates/schema";

const doc = (text: string): TemplateDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const BLOCKS = [
  { id: "cap", name: "Caption", isActive: true, content: doc("DEFAULT CAPTION") },
  { id: "cap2", name: "Federal caption", isActive: true, content: doc("FEDERAL CAPTION") },
  { id: "sig", name: "Signature", isActive: true, content: doc("DEFAULT SIG") },
  { id: "old", name: "Old caption", isActive: false, content: doc("OLD CAPTION") },
];

const NULL_VALUES = {
  fontKey: null,
  fontSizeHalfPt: null,
  lineSpacing: null,
  spaceAfterPt: null,
  marginTopIn: null,
  marginRightIn: null,
  marginBottomIn: null,
  marginLeftIn: null,
  pageNumbers: null,
  paperSize: "letter" as const,
  styleOverrides: {},
};

const { fontSizeHalfPt, lineSpacing, spaceAfterPt, ...SENT_NULLS } = NULL_VALUES;
void [fontSizeHalfPt, lineSpacing, spaceAfterPt];

const base = {
  initial: {
    id: "cf1",
    name: "Colorado District",
    courtSystem: "state" as const,
    values: NULL_VALUES,
    replacements: [] as { blockId: string; replacementBlockId: string }[],
    updatedAt: "2026-10-22T10:00:00.000Z",
  },
  house: DEFAULT_DOCUMENT_STYLE,
  blocks: BLOCKS,
  canSave: true,
};

beforeEach(() => {
  saveCourtFormat.mockReset();
  replace.mockReset();
});
afterEach(cleanup);

const optionLabels = (el: HTMLElement) =>
  within(el)
    .getAllByRole("option")
    .map((o) => o.textContent);

describe("CourtFormatEditor", () => {
  test("save sends nulls for house-style fields, replacements, and expectedUpdatedAt; adopts updatedAt", async () => {
    saveCourtFormat.mockResolvedValue({
      ok: true,
      id: "cf1",
      updatedAt: "2026-10-22T11:00:00.000Z",
    });
    render(<CourtFormatEditor {...base} />);
    fireEvent.change(screen.getByLabelText("Paper size"), { target: { value: "legal" } });
    fireEvent.click(screen.getByRole("button", { name: "Add replacement" }));
    fireEvent.change(screen.getByLabelText("Block to replace 1"), { target: { value: "cap" } });
    fireEvent.change(screen.getByLabelText("Replacement block 1"), {
      target: { value: "cap2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCourtFormat).toHaveBeenCalledTimes(1));
    expect(saveCourtFormat).toHaveBeenCalledWith({
      id: "cf1",
      name: "Colorado District",
      courtSystem: "state",
      ...SENT_NULLS,
      paperSize: "legal",
      replacements: [{ blockId: "cap", replacementBlockId: "cap2" }],
      expectedUpdatedAt: "2026-10-22T10:00:00.000Z",
    });
    await screen.findByText("Saved");
    // "Saved" renders while the transition is still pending (button reads
    // "Saving…" and is disabled); wait for it to settle before saving again.
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCourtFormat).toHaveBeenCalledTimes(2));
    expect(saveCourtFormat.mock.calls[1][0].expectedUpdatedAt).toBe("2026-10-22T11:00:00.000Z");
  });

  test("Styles section shows firm values as placeholders and sends only set fields", async () => {
    saveCourtFormat.mockResolvedValue({
      ok: true,
      id: "cf1",
      updatedAt: "2026-10-22T11:00:00.000Z",
    });
    render(<CourtFormatEditor {...base} />);
    const firmBody = DEFAULT_DOCUMENT_STYLE.paragraphStyles.find((s) => s.key === "body")!;
    const size = screen.getByLabelText("Size (pt)") as HTMLInputElement;
    expect(size.value).toBe("");
    expect(size.placeholder).toBe(String(firmBody.values.sizePt));
    expect(screen.queryByLabelText("Use house style for Font size")).toBeNull();
    fireEvent.change(size, { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Line spacing"), { target: { value: "double" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCourtFormat).toHaveBeenCalledTimes(1));
    const sent = saveCourtFormat.mock.calls[0][0];
    expect(sent.styleOverrides).toEqual({ body: { sizePt: 14, lineSpacing: "double" } });
    expect(sent).not.toHaveProperty("fontSizeHalfPt");
    // Reset removes just that field; a style with nothing left sends nothing.
    fireEvent.click(screen.getByRole("button", { name: "Reset Size (pt)" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Line spacing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCourtFormat).toHaveBeenCalledTimes(2));
    expect(saveCourtFormat.mock.calls[1][0].styleOverrides).toEqual({});
  });

  test("overrides apply to the picked style and other styles' fields start unset", async () => {
    render(
      <CourtFormatEditor
        {...base}
        initial={{
          ...base.initial,
          values: { ...NULL_VALUES, styleOverrides: { body: { sizePt: 13 } } },
        }}
      />,
    );
    expect((screen.getByLabelText("Size (pt)") as HTMLInputElement).value).toBe("13");
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "caption" } });
    expect((screen.getByLabelText("Size (pt)") as HTMLInputElement).value).toBe("");
  });

  test("a margin override sends a number", async () => {
    saveCourtFormat.mockResolvedValue({
      ok: true,
      id: "cf1",
      updatedAt: "2026-10-22T11:00:00.000Z",
    });
    render(<CourtFormatEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Use house style for Top margin (in)"));
    fireEvent.change(screen.getByLabelText("Top margin (in)"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCourtFormat).toHaveBeenCalled());
    expect(saveCourtFormat.mock.calls[0][0].marginTopIn).toBe(1.5);
  });

  test("replacement selects: no self-replacement, no duplicate source, archived labelled", () => {
    render(
      <CourtFormatEditor
        {...base}
        initial={{
          ...base.initial,
          replacements: [
            { blockId: "cap", replacementBlockId: "old" },
            { blockId: "", replacementBlockId: "" },
          ],
        }}
      />,
    );
    const repl1 = screen.getByLabelText("Replacement block 1");
    expect(optionLabels(repl1)).not.toContain("Caption");
    expect(optionLabels(repl1)).toContain("Old caption (archived)");
    const block2 = screen.getByLabelText("Block to replace 2");
    expect(optionLabels(block2)).not.toContain("Caption");
    expect(optionLabels(block2)).not.toContain("Old caption (archived)");
    expect(optionLabels(block2)).toContain("Signature");
    // Row 1 may still pick its own block.
    expect(optionLabels(screen.getByLabelText("Block to replace 1"))).toContain("Caption");
  });

  test("the sample preview shows the replacement", () => {
    render(
      <CourtFormatEditor
        {...base}
        initial={{
          ...base.initial,
          replacements: [{ blockId: "cap", replacementBlockId: "cap2" }],
        }}
      />,
    );
    expect(screen.getByText("FEDERAL CAPTION")).toBeInTheDocument();
    expect(screen.queryByText("DEFAULT CAPTION")).toBeNull();
  });

  test("an incomplete replacement row blocks save", async () => {
    render(<CourtFormatEditor {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Add replacement" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Choose both blocks for each replacement, or remove the row.");
    expect(saveCourtFormat).not.toHaveBeenCalled();
  });

  test("stale error offers Reload", async () => {
    saveCourtFormat.mockResolvedValue({
      ok: false,
      error: "Someone else saved this court format — reload to see their changes.",
    });
    render(<CourtFormatEditor {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Someone else saved this court format/);
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  test("new format omits id and expectedUpdatedAt, then routes to the new id", async () => {
    saveCourtFormat.mockResolvedValue({
      ok: true,
      id: "new1",
      updatedAt: "2026-10-22T11:00:00.000Z",
    });
    render(
      <CourtFormatEditor
        {...base}
        initial={{ ...base.initial, id: null, name: "", updatedAt: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Federal" } });
    fireEvent.change(screen.getByLabelText("Court system"), { target: { value: "federal" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCourtFormat).toHaveBeenCalledTimes(1));
    const sent = saveCourtFormat.mock.calls[0][0];
    expect(sent).not.toHaveProperty("id");
    expect(sent).not.toHaveProperty("expectedUpdatedAt");
    expect(sent.courtSystem).toBe("federal");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/settings/court-formats/new1"));
  });

  test("read-only disables controls and hides Save", () => {
    render(<CourtFormatEditor {...base} canSave={false} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Paper size") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Add replacement" })).toBeNull();
  });
});
