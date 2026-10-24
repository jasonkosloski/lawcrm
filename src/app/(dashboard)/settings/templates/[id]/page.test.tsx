/**
 * Template and block editor routes: auth first, `new` needs the create
 * key, unknown ids 404, and saving is gated on the edit key.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn().mockResolvedValue("u1") }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("u1"),
  getCurrentUserPermissions: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/templates/editor-data", () => ({
  loadBlockSources: vi.fn().mockResolvedValue([]),
  loadEditorPageStyle: vi.fn().mockResolvedValue(null),
  loadEditorCourtFormats: vi.fn().mockResolvedValue([]),
  loadEditorTemplate: vi.fn(),
  loadEditorBlock: vi.fn(),
}));
vi.mock("@/app/actions/template-blocks", () => ({
  listBlockUsage: vi.fn().mockResolvedValue([{ id: "t1", name: "Demand" }]),
}));
vi.mock("@/components/templates/editor/template-editor-page", () => ({
  TemplateEditorPage: (p: {
    canSave: boolean;
    template?: { name: string };
    block?: { name: string };
    usage?: unknown[];
  }) => (
    <div data-testid="editor">
      {p.template?.name ?? p.block?.name}|{String(p.canSave)}|{p.usage?.length ?? "-"}
    </div>
  ),
}));

import { getCurrentUserPermissions, requirePermission } from "@/lib/permission-check";
import { loadEditorBlock, loadEditorTemplate } from "@/lib/templates/editor-data";
import TemplatePage from "./page";
import BlockPage from "../blocks/[id]/page";

const perms = (keys: string[]) =>
  vi
    .mocked(getCurrentUserPermissions)
    .mockResolvedValue({ isAdmin: false, granted: new Set(keys) });
const params = (id: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve({}),
});

beforeEach(() => {
  vi.mocked(requirePermission).mockClear();
  vi.mocked(loadEditorTemplate).mockResolvedValue({
    id: "t1",
    name: "Demand",
    category: "general",
    description: null,
    documentTitle: null,
    kind: "letter",
    appliesTo: "matter",
    content: null,
    body: "x",
    subject: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
  vi.mocked(loadEditorBlock).mockResolvedValue({
    id: "b1",
    key: "sig",
    name: "Sig",
    description: null,
    appliesTo: "both",
    content: { type: "doc" },
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
});

describe("template editor route", () => {
  test("new needs the create key", async () => {
    perms([]);
    render(await TemplatePage(params("new") as never));
    expect(requirePermission).toHaveBeenCalledWith("documents.template.create");
    expect(screen.getByTestId("editor").textContent).toBe("|true|-");
  });

  test("an existing template is read-only without the edit key", async () => {
    perms([]);
    render(await TemplatePage(params("t1") as never));
    expect(requirePermission).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor").textContent).toBe("Demand|false|-");
  });

  test("the edit key allows saving", async () => {
    perms(["documents.template.edit"]);
    render(await TemplatePage(params("t1") as never));
    expect(screen.getByTestId("editor").textContent).toBe("Demand|true|-");
  });

  test("an unknown id is a 404", async () => {
    perms(["documents.template.edit"]);
    vi.mocked(loadEditorTemplate).mockResolvedValue(null);
    await expect(TemplatePage(params("nope") as never)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("block editor route", () => {
  test("passes usage and the edit flag", async () => {
    perms(["documents.template.edit"]);
    render(await BlockPage(params("b1") as never));
    expect(screen.getByTestId("editor").textContent).toBe("Sig|true|1");
  });

  test("an unknown id is a 404", async () => {
    perms([]);
    vi.mocked(loadEditorBlock).mockResolvedValue(null);
    await expect(BlockPage(params("nope") as never)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
