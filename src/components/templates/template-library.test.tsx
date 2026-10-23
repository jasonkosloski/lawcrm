/**
 * TemplateLibrary — Templates / Blocks tabs, kind and applies-to
 * filters, category ordering, rows linking to the editor pages, and
 * per-row menu gating. Actions are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setActive = vi.fn();
const deleteTemplate = vi.fn();
const setBlockActive = vi.fn();
const deleteBlock = vi.fn();
vi.mock("@/app/actions/document-templates", () => ({
  setDocumentTemplateActive: (...a: unknown[]) => setActive(...a),
  deleteDocumentTemplate: (...a: unknown[]) => deleteTemplate(...a),
}));
vi.mock("@/app/actions/template-blocks", () => ({
  setTemplateBlockActive: (...a: unknown[]) => setBlockActive(...a),
  deleteTemplateBlock: (...a: unknown[]) => deleteBlock(...a),
}));

import { checkTemplateFit } from "@/lib/templates/inspect";
import type { TemplateDoc } from "@/lib/templates/schema";
import { TemplateLibrary, type BlockListItem, type TemplateListItem } from "./template-library";

const row = (over: Partial<TemplateListItem>): TemplateListItem => ({
  id: "x",
  name: "Template",
  category: "general",
  description: null,
  kind: "letter",
  appliesTo: "matter",
  isActive: true,
  updatedAtLabel: "Apr 15, 2026",
  createdByName: null,
  ...over,
});

const TEMPLATES = [
  row({ id: "1", name: "Stray one", category: "intake" }),
  row({ id: "2", name: "General one", category: "general", kind: "email", appliesTo: "lead" }),
  row({ id: "3", name: "Demand one", category: "demand_letter" }),
  row({ id: "4", name: "Old demand", category: "demand_letter", isActive: false }),
];

const BLOCKS: BlockListItem[] = [
  {
    id: "b1",
    key: "signature",
    name: "Signature",
    description: null,
    isActive: true,
    updatedAtLabel: "Apr 15, 2026",
    misfit: false,
  },
  {
    id: "b2",
    key: "old_footer",
    name: "Old footer",
    description: null,
    isActive: false,
    updatedAtLabel: "Apr 1, 2026",
    misfit: false,
  },
];

const lib = (over: Partial<Parameters<typeof TemplateLibrary>[0]> = {}) => (
  <TemplateLibrary
    templates={TEMPLATES}
    blocks={BLOCKS}
    canCreate={false}
    canEdit={false}
    canDelete={false}
    {...over}
  />
);

beforeEach(() => {
  setActive.mockReset().mockResolvedValue({ ok: true });
  deleteTemplate.mockReset().mockResolvedValue({ ok: true });
  setBlockActive.mockReset().mockResolvedValue({ ok: true });
  deleteBlock.mockReset().mockResolvedValue({ ok: true });
});

describe("TemplateLibrary", () => {
  it("lists curated categories in catalog order, then stray categories, then archived", () => {
    render(lib());
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Demand letters", "General", "intake", "Archived (1)"]);
  });

  it("rows link to the editor page", () => {
    render(lib());
    expect(screen.getByRole("link", { name: "Demand one" })).toHaveAttribute(
      "href",
      "/settings/templates/3",
    );
  });

  it("filters by kind and applies-to", async () => {
    const user = userEvent.setup();
    render(lib());
    await user.selectOptions(screen.getByLabelText("Kind"), "email");
    expect(screen.getByRole("link", { name: "General one" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Demand one" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Kind"), "all");
    await user.selectOptions(screen.getByLabelText("Applies to"), "matter");
    expect(screen.queryByRole("link", { name: "General one" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Demand one" })).toBeInTheDocument();
  });

  it("the Blocks tab lists blocks linking to the block editor", async () => {
    const user = userEvent.setup();
    render(lib({ canCreate: true }));
    expect(screen.getByRole("tab", { name: "Templates" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Blocks" }));
    expect(screen.getByRole("link", { name: "Signature" })).toHaveAttribute(
      "href",
      "/settings/templates/blocks/b1",
    );
    expect(screen.getByText("Archived (1)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new block/i })).toHaveAttribute(
      "href",
      "/settings/templates/blocks/new",
    );
    expect(screen.queryByRole("link", { name: "Demand one" })).not.toBeInTheDocument();
  });

  it("marks a block whose fields don't fit its scope", async () => {
    const user = userEvent.setup();
    // As the settings page computes it: a "both" block with a matter-only field.
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "field", attrs: { path: "matter.caseNumber" } }] },
      ],
    } as TemplateDoc;
    const misfit = !checkTemplateFit(content, "both").ok;
    render(lib({ blocks: [{ ...BLOCKS[0]!, id: "b3", name: "Caption", misfit }, BLOCKS[0]!] }));
    await user.click(screen.getByRole("tab", { name: "Blocks" }));
    expect(screen.getAllByText("Fields don't fit its scope")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Caption" }).parentElement).toHaveTextContent(
      "Fields don't fit its scope",
    );
  });

  it("renders no manage affordances for a read-only viewer", () => {
    render(lib());
    expect(screen.queryByRole("link", { name: /new template/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actions for/i })).not.toBeInTheDocument();
  });

  it("offers Archive but not Delete when only canEdit", async () => {
    const user = userEvent.setup();
    render(lib({ canEdit: true }));
    await user.click(screen.getByRole("button", { name: "Actions for Demand one" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByText("Archive")).toBeInTheDocument();
    expect(menu.queryByText(/delete permanently/i)).not.toBeInTheDocument();
  });

  it("archives and restores templates and blocks through their actions", async () => {
    const user = userEvent.setup();
    render(lib({ canEdit: true }));
    await user.click(screen.getByRole("button", { name: "Actions for Demand one" }));
    await user.click(screen.getByText("Archive"));
    expect(setActive).toHaveBeenCalledWith("3", false);

    await user.click(screen.getByRole("tab", { name: "Blocks" }));
    await user.click(screen.getByRole("button", { name: "Actions for Old footer" }));
    await user.click(screen.getByText("Restore"));
    expect(setBlockActive).toHaveBeenCalledWith("b2", true);
  });

  it("shows the create link and empty state to a creator", () => {
    render(lib({ templates: [], canCreate: true }));
    expect(screen.getByRole("link", { name: /new template/i })).toHaveAttribute(
      "href",
      "/settings/templates/new",
    );
    expect(screen.getByText("No templates yet")).toBeInTheDocument();
  });
});
