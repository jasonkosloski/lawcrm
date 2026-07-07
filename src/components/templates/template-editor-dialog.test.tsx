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
import { render, screen, within } from "@testing-library/react";
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
