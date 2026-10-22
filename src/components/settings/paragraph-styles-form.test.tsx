import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const saveParagraphStyles = vi.fn();
vi.mock("@/app/actions/document-style", () => ({
  saveParagraphStyles: (...a: unknown[]) => saveParagraphStyles(...a),
}));

import { ParagraphStylesForm } from "./paragraph-styles-form";
import { defaultParagraphStyles, type ParagraphStyle } from "@/lib/templates/paragraph-styles";

const defaults = () =>
  defaultParagraphStyles({ fontSizeHalfPt: 24, lineSpacing: "single", spaceAfterPt: 12 });
const withCustom = (): ParagraphStyle[] => [
  ...defaults(),
  { key: "note", name: "Note", builtIn: false, values: defaults()[0].values },
];

const props = (over: Partial<Parameters<typeof ParagraphStylesForm>[0]> = {}) => ({
  initial: withCustom(),
  updatedAt: "2026-10-22T10:00:00.000Z",
  fontKey: "times" as const,
  canEdit: true,
  ...over,
});
const names = () =>
  within(screen.getByRole("list", { name: "Styles" }))
    .getAllByRole("button")
    .map((b) => b.textContent);

beforeEach(() => saveParagraphStyles.mockReset());
afterEach(cleanup);

describe("ParagraphStylesForm", () => {
  test("lists built-ins first, then custom styles", () => {
    render(<ParagraphStylesForm {...props()} />);
    expect(names()).toEqual([
      "Body",
      "Title",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Caption",
      "Block quote",
      "Signature",
      "Note",
    ]);
  });

  test("Add style copies the selected style under a new name", () => {
    render(<ParagraphStylesForm {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    fireEvent.click(screen.getByRole("button", { name: /Add style/ }));
    expect(names().at(-1)).toBe("Title copy");
    expect((screen.getByLabelText("Style name") as HTMLInputElement).value).toBe("Title copy");
    expect((screen.getByLabelText("Bold") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Alignment") as HTMLSelectElement).value).toBe("center");
  });

  test("renames a custom style; built-ins keep their names", () => {
    render(<ParagraphStylesForm {...props()} />);
    expect((screen.getByLabelText("Style name") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    fireEvent.change(screen.getByLabelText("Style name"), { target: { value: "Aside" } });
    expect(names().at(-1)).toBe("Aside");
  });

  test("Delete is offered for custom styles only", () => {
    render(<ParagraphStylesForm {...props()} />);
    expect(screen.queryByRole("button", { name: /Delete style/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete style/ }));
    expect(names()).not.toContain("Note");
  });

  test("the sample uses the house font and the style's values", () => {
    render(<ParagraphStylesForm {...props({ fontKey: "garamond" })} />);
    fireEvent.change(screen.getByLabelText("Size (pt)"), { target: { value: "14" } });
    fireEvent.click(screen.getByLabelText("Bold"));
    const sample = screen.getByTestId("style-sample").getAttribute("style") ?? "";
    expect(sample).toContain("Tpl EB Garamond");
    expect(sample).toContain("font-size: 14pt");
    expect(sample).toContain("font-weight: bold");
  });

  test("Save sends the whole list and the lock token, then adopts the new timestamp", async () => {
    saveParagraphStyles.mockResolvedValue({ ok: true, updatedAt: "2026-10-22T11:00:00.000Z" });
    render(<ParagraphStylesForm {...props()} />);
    fireEvent.change(screen.getByLabelText("Size (pt)"), { target: { value: "13" } });
    fireEvent.click(screen.getByRole("button", { name: "Save styles" }));
    await screen.findByText("Saved");
    const sent = saveParagraphStyles.mock.calls[0][0];
    expect(sent.expectedUpdatedAt).toBe("2026-10-22T10:00:00.000Z");
    expect(sent.styles).toHaveLength(9);
    expect(sent.styles[0].values.sizePt).toBe(13);
    fireEvent.click(screen.getByRole("button", { name: "Save styles" }));
    await waitFor(() => expect(saveParagraphStyles).toHaveBeenCalledTimes(2));
    expect(saveParagraphStyles.mock.calls[1][0].expectedUpdatedAt).toBe("2026-10-22T11:00:00.000Z");
  });

  test("shows the server error and a Reload button when stale", async () => {
    saveParagraphStyles.mockResolvedValue({
      ok: false,
      error: "Someone else saved the document style — reload to see their changes.",
    });
    render(<ParagraphStylesForm {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save styles" }));
    await screen.findByText(/Someone else saved/);
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  test("shows a usage refusal from the server", async () => {
    saveParagraphStyles.mockResolvedValue({
      ok: false,
      error: "Note is used by 2 templates: A, B.",
    });
    render(<ParagraphStylesForm {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save styles" }));
    await screen.findByText("Note is used by 2 templates: A, B.");
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  test("is read-only without permission", () => {
    render(<ParagraphStylesForm {...props({ canEdit: false })} />);
    expect(screen.queryByRole("button", { name: "Save styles" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add style/ })).toBeNull();
    expect((screen.getByLabelText("Size (pt)") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Bold") as HTMLInputElement).disabled).toBe(true);
  });
});
