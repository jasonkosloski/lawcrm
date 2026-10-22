/**
 * TemplateLibrary — category ordering, archived section, and the
 * per-row menu gating (edit / archive / delete by permission flag).
 * Actions are mocked; the editor dialog is stubbed out (covered in
 * template-editor-dialog.test.tsx).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setActive = vi.fn();
const deleteTemplate = vi.fn();
vi.mock("@/app/actions/document-templates", () => ({
  setDocumentTemplateActive: (...a: unknown[]) => setActive(...a),
  deleteDocumentTemplate: (...a: unknown[]) => deleteTemplate(...a),
  createDocumentTemplate: vi.fn(),
  updateDocumentTemplate: vi.fn(),
}));
vi.mock("@/components/templates/template-editor-dialog", () => ({
  TemplateEditorDialog: () => null,
}));

import { TemplateLibrary, type TemplateListItem } from "./template-library";

const row = (over: Partial<TemplateListItem>): TemplateListItem => ({
  id: "x",
  name: "Template",
  category: "general",
  description: null,
  body: "",
  isActive: true,
  updatedAtLabel: "Apr 15, 2026",
  createdByName: null,
  ...over,
});

const TEMPLATES = [
  row({ id: "1", name: "Stray one", category: "intake" }),
  row({ id: "2", name: "General one", category: "general" }),
  row({ id: "3", name: "Demand one", category: "demand_letter" }),
  row({ id: "4", name: "Old demand", category: "demand_letter", isActive: false }),
];

beforeEach(() => {
  setActive.mockReset().mockResolvedValue({ ok: true });
  deleteTemplate.mockReset().mockResolvedValue({ ok: true });
});

describe("TemplateLibrary", () => {
  it("lists curated categories in catalog order, then stray categories, then archived", () => {
    render(
      <TemplateLibrary templates={TEMPLATES} canCreate={false} canEdit={false} canDelete={false} />,
    );
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Demand letters", "General", "intake", "Archived (1)"]);
  });

  it("renders no manage affordances for a read-only viewer", () => {
    render(
      <TemplateLibrary templates={TEMPLATES} canCreate={false} canEdit={false} canDelete={false} />,
    );
    expect(screen.queryByRole("button", { name: /new template/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actions for/i })).not.toBeInTheDocument();
  });

  it("offers Edit + Archive but not Delete when only canEdit", async () => {
    const user = userEvent.setup();
    render(<TemplateLibrary templates={TEMPLATES} canCreate={false} canEdit canDelete={false} />);
    await user.click(screen.getByRole("button", { name: "Actions for Demand one" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByText("Edit")).toBeInTheDocument();
    expect(menu.getByText("Archive")).toBeInTheDocument();
    expect(menu.queryByText(/delete permanently/i)).not.toBeInTheDocument();
  });

  it("offers only Delete when only canDelete, and archived rows offer Restore", async () => {
    const user = userEvent.setup();
    render(<TemplateLibrary templates={TEMPLATES} canCreate={false} canEdit={false} canDelete />);
    await user.click(screen.getByRole("button", { name: "Actions for Demand one" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByText(/delete permanently/i)).toBeInTheDocument();
    expect(menu.queryByText("Edit")).not.toBeInTheDocument();
    expect(menu.queryByText("Archive")).not.toBeInTheDocument();
  });

  it("archives and restores through the action", async () => {
    const user = userEvent.setup();
    render(<TemplateLibrary templates={TEMPLATES} canCreate={false} canEdit canDelete={false} />);
    await user.click(screen.getByRole("button", { name: "Actions for Demand one" }));
    await user.click(screen.getByText("Archive"));
    expect(setActive).toHaveBeenCalledWith("3", false);

    await user.click(screen.getByRole("button", { name: "Actions for Old demand" }));
    await user.click(screen.getByText("Restore"));
    expect(setActive).toHaveBeenCalledWith("4", true);
  });

  it("shows the create button and empty state to a creator", () => {
    render(<TemplateLibrary templates={[]} canCreate canEdit={false} canDelete={false} />);
    expect(screen.getByRole("button", { name: /new template/i })).toBeInTheDocument();
    expect(screen.getByText("No templates yet")).toBeInTheDocument();
  });
});
