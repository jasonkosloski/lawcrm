/**
 * Settings — Court format editor. `new` creates (needs
 * `court_formats.add`); otherwise it edits (`court_formats.edit`, and
 * read-only for anyone else who can open the list). Unknown ids 404.
 */

import { notFound } from "next/navigation";
import {
  CourtFormatEditor,
  type CourtFormatEditorInitial,
} from "@/components/settings/court-format-editor";
import { requireUser } from "@/lib/current-user";
import { currentUserHasAnyPermission, currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getDocumentStyle } from "@/lib/templates/document-style";
import type {
  CourtSystem,
  FontKey,
  LineSpacing,
  PageNumberPosition,
  PaperSize,
} from "@/lib/templates/page-style";
import type { TemplateDoc } from "@/lib/templates/schema";

const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

const NEW_FORMAT: CourtFormatEditorInitial = {
  id: null,
  name: "",
  courtSystem: "state",
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
    paperSize: "letter",
    styleOverrides: {},
  },
  replacements: [],
  updatedAt: null,
};

export default async function CourtFormatEditorRoute({
  params,
}: PageProps<"/settings/court-formats/[id]">) {
  await requireUser();
  const { id } = await params;
  const isNew = id === "new";
  if (
    !(await currentUserHasAnyPermission([
      "court_formats.add",
      "court_formats.edit",
      "court_formats.delete",
    ]))
  ) {
    notFound();
  }

  const [row, blockRows, house, canSave] = await Promise.all([
    isNew
      ? Promise.resolve(null)
      : prisma.courtFormat.findUnique({
          where: { id },
          include: { blocks: { orderBy: { id: "asc" } } },
        }),
    prisma.templateBlock.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, content: true },
    }),
    getDocumentStyle(),
    currentUserHasPermission(isNew ? "court_formats.add" : "court_formats.edit"),
  ]);
  if (!isNew && !row) notFound();

  const initial: CourtFormatEditorInitial = row
    ? {
        id: row.id,
        name: row.name,
        courtSystem: row.courtSystem as CourtSystem,
        values: {
          fontKey: row.fontKey as FontKey | null,
          fontSizeHalfPt: row.fontSizeHalfPt,
          lineSpacing: row.lineSpacing as LineSpacing | null,
          spaceAfterPt: row.spaceAfterPt,
          marginTopIn: num(row.marginTopIn),
          marginRightIn: num(row.marginRightIn),
          marginBottomIn: num(row.marginBottomIn),
          marginLeftIn: num(row.marginLeftIn),
          pageNumbers: row.pageNumbers as PageNumberPosition | null,
          paperSize: row.paperSize as PaperSize,
          styleOverrides: {},
        },
        replacements: row.blocks.map((b) => ({
          blockId: b.blockId,
          replacementBlockId: b.replacementBlockId,
        })),
        updatedAt: row.updatedAt.toISOString(),
      }
    : NEW_FORMAT;

  const { id: _id, updatedAt: _u, logoKey: _k, logoContentType: _c, ...houseValues } = house;
  void _id;
  void _u;
  void _k;
  void _c;

  return (
    <div className="max-w-6xl">
      <div className="mb-4">
        <h1 className="text-base font-semibold text-ink">
          {isNew ? "New court format" : row!.name}
        </h1>
        <p className="mt-1 text-xs text-ink-3">
          Settings left on the house style follow Settings → Documents.
          {!canSave && " You can view this court format but not change it."}
        </p>
      </div>
      <CourtFormatEditor
        key={id}
        initial={initial}
        house={houseValues}
        blocks={blockRows.map((b) => ({ ...b, content: b.content as unknown as TemplateDoc }))}
        canSave={canSave}
      />
    </div>
  );
}
