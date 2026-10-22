/**
 * /settings/court-formats/[id] — gating, unknown ids, new vs. existing.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn(async () => "user_1") }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasAnyPermission: vi.fn(async () => true),
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    courtFormat: { findUnique: (...a: unknown[]) => findUnique(...a) },
    templateBlock: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/templates/document-style", async () => {
  const { DEFAULT_DOCUMENT_STYLE } = await import("@/lib/templates/page-style");
  return {
    getDocumentStyle: vi.fn(async () => ({
      ...DEFAULT_DOCUMENT_STYLE,
      id: "s",
      updatedAt: new Date(),
      logoKey: null,
      logoContentType: null,
    })),
  };
});
vi.mock("@/components/settings/court-format-editor", () => ({
  CourtFormatEditor: ({
    initial,
    canSave,
  }: {
    initial: { id: string | null; name: string; updatedAt: string | null };
    canSave: boolean;
  }) => (
    <div data-can-save={String(canSave)}>
      {initial.id ?? "NEW"}:{initial.name}:{initial.updatedAt}
    </div>
  ),
}));

import { currentUserHasAnyPermission, currentUserHasPermission } from "@/lib/permission-check";
import Page from "./page";

const params = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUserHasAnyPermission).mockResolvedValue(true);
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
});

describe("/settings/court-formats/[id]", () => {
  test("without any court-format key: notFound, no reads", async () => {
    vi.mocked(currentUserHasAnyPermission).mockResolvedValue(false);
    await expect(Page(params("new"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(findUnique).not.toHaveBeenCalled();
  });

  test("unknown id: notFound", async () => {
    findUnique.mockResolvedValue(null);
    await expect(Page(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("new: needs .add to save", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(async (k) => k === "court_formats.add");
    render(await Page(params("new")));
    expect(currentUserHasPermission).toHaveBeenCalledWith("court_formats.add");
    expect(screen.getByText(/NEW:/)).toHaveAttribute("data-can-save", "true");
    expect(findUnique).not.toHaveBeenCalled();
  });

  test("existing without .edit renders read-only", async () => {
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    findUnique.mockResolvedValue({
      id: "cf1",
      name: "CO District",
      courtSystem: "state",
      fontKey: null,
      fontSizeHalfPt: null,
      lineSpacing: null,
      spaceAfterPt: null,
      marginTopIn: { toString: () => "1.25" },
      marginRightIn: null,
      marginBottomIn: null,
      marginLeftIn: null,
      pageNumbers: null,
      paperSize: "legal",
      updatedAt: new Date("2026-10-22T10:00:00.000Z"),
      blocks: [],
    });
    render(await Page(params("cf1")));
    expect(screen.getByText("cf1:CO District:2026-10-22T10:00:00.000Z")).toHaveAttribute(
      "data-can-save",
      "false",
    );
  });
});
