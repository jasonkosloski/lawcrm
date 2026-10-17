/**
 * Template Editor Dialog — insert-field picker.
 *
 * Reproducer for a Base UI constraint: DropdownMenuLabel maps to
 * Menu.GroupLabel, which throws ("MenuGroupRootContext is missing")
 * unless it sits inside a Menu.Group. The field picker renders one
 * label per merge-field group, so opening the menu exercises every
 * group. These tests fail if the Group wrapper is ever dropped.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateEditorDialog } from "./template-editor-dialog";
import { MERGE_FIELD_GROUPS } from "@/lib/template-merge";

vi.mock("@/app/actions/document-templates", () => ({
  createDocumentTemplate: vi.fn(),
  updateDocumentTemplate: vi.fn(),
}));

describe("TemplateEditorDialog insert-field picker", () => {
  it("opens the grouped field menu without throwing and lists every group + field", async () => {
    const user = userEvent.setup();
    render(
      <TemplateEditorDialog open onOpenChange={() => {}} template={null} />
    );

    await user.click(screen.getByRole("button", { name: /insert field/i }));

    // Scope to the menu — group names like "General" also appear as
    // category <option> text in the form behind it.
    const menu = within(screen.getByRole("menu"));
    for (const group of MERGE_FIELD_GROUPS) {
      expect(menu.getByText(group.group)).toBeInTheDocument();
      for (const field of group.fields) {
        expect(menu.getByText(field.key)).toBeInTheDocument();
      }
    }
  });

  it("inserts the picked field token into the body textarea", async () => {
    const user = userEvent.setup();
    render(<TemplateEditorDialog open onOpenChange={() => {}} template={null} />);

    await user.click(screen.getByRole("button", { name: /insert field/i }));
    const first = MERGE_FIELD_GROUPS[0].fields[0];
    await user.click(screen.getByText(first.key));

    // Dialog content mounts in a portal — query the document, not
    // the render container.
    const body = document.querySelector(
      '[name="body"]'
    ) as HTMLTextAreaElement;
    expect(body.value).toContain(`{{${first.key}}}`);
  });
});

const legacyTemplate = {
  id: "t1",
  name: "Imported memo",
  category: "intake",
  description: null,
  body: "Hello {{matter.name}}",
  isActive: true,
  updatedAtLabel: "Apr 15, 2026",
  createdByName: null,
};

describe("TemplateEditorDialog edit + preview behaviour", () => {
  it("keeps a non-curated category selected instead of snapping to the first option", () => {
    // The page keeps the dialog mounted and flips `open`, which is
    // when the fields sync from the row.
    const { rerender } = render(
      <TemplateEditorDialog
        open={false}
        onOpenChange={() => {}}
        template={legacyTemplate}
      />
    );
    rerender(
      <TemplateEditorDialog
        open
        onOpenChange={() => {}}
        template={legacyTemplate}
      />
    );
    const select = document.querySelector(
      '[name="category"]'
    ) as HTMLSelectElement;
    expect(select.value).toBe("intake");
    expect(select.selectedOptions[0]?.textContent).toBe("intake");
  });

  it("marks the active Write/Preview mode with aria-pressed", async () => {
    const user = userEvent.setup();
    render(<TemplateEditorDialog open onOpenChange={() => {}} template={null} />);

    const write = screen.getByRole("button", { name: "Write" });
    const preview = screen.getByRole("button", { name: "Preview" });
    expect(write).toHaveAttribute("aria-pressed", "true");
    expect(preview).toHaveAttribute("aria-pressed", "false");

    await user.click(preview);
    expect(write).toHaveAttribute("aria-pressed", "false");
    expect(preview).toHaveAttribute("aria-pressed", "true");
  });

  it("returns to Write mode when the hidden required body is invalid", async () => {
    const user = userEvent.setup();
    render(<TemplateEditorDialog open onOpenChange={() => {}} template={null} />);

    await user.click(screen.getByRole("button", { name: "Preview" }));
    const body = document.querySelector('[name="body"]') as HTMLTextAreaElement;
    expect(body.className).toContain("hidden");

    fireEvent.invalid(body);
    expect(screen.getByRole("button", { name: "Write" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(body.className).not.toContain("hidden");
  });

  it("warns about malformed tokens in the sample preview", async () => {
    const user = userEvent.setup();
    render(<TemplateEditorDialog open onOpenChange={() => {}} template={null} />);

    const body = document.querySelector('[name="body"]') as HTMLTextAreaElement;
    await user.click(body);
    await user.paste("Dear {{client-name}}");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText(/Unknown fields/)).toHaveTextContent(
      "{{client-name}}"
    );
  });
});
