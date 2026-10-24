/**
 * Server-side loaders for the template and block editor pages. Callers
 * authenticate first (ADR-028); these only read.
 */

import { prisma } from "@/lib/prisma";
import { toSerializedCourt, type SerializedCourtContext } from "./court-blocks";
import { getDocumentStyle } from "./document-style";
import type { FontKey } from "./fonts";
import type { CourtFormatValues } from "./page-style";
import { logoPreviewUrl, logoRefOf, type FirmPageStyle } from "./page-render";
import { readStyleOverrides } from "./paragraph-styles";
import type { BlockSource } from "./render";
import type { AppliesTo, TemplateDoc, TemplateKind } from "./schema";

/** Every block (active and archived) with content, for rendering refs. */
export async function loadBlockSources(): Promise<BlockSource[]> {
  const rows = await prisma.templateBlock.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true, content: true, appliesTo: true },
  });
  return rows.map((r) => ({
    ...r,
    content: r.content as unknown as TemplateDoc,
    appliesTo: r.appliesTo as AppliesTo,
  }));
}

export async function loadEditorTemplate(id: string) {
  const t = await prisma.documentTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
      documentTitle: true,
      kind: true,
      appliesTo: true,
      content: true,
      body: true,
      subject: true,
      updatedAt: true,
    },
  });
  if (!t) return null;
  return {
    ...t,
    kind: t.kind as TemplateKind,
    appliesTo: t.appliesTo as AppliesTo,
    content: (t.content as unknown as TemplateDoc | null) ?? null,
    subject: (t.subject as unknown as TemplateDoc | null) ?? null,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function loadEditorBlock(id: string) {
  const b = await prisma.templateBlock.findUnique({
    where: { id },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      appliesTo: true,
      content: true,
      updatedAt: true,
    },
  });
  if (!b) return null;
  return {
    ...b,
    appliesTo: b.appliesTo as AppliesTo,
    content: b.content as unknown as TemplateDoc,
    updatedAt: b.updatedAt.toISOString(),
  };
}

/** The firm document style for the editor's sample preview. Picks the
 *  style values explicitly so the logo's storage key stays server-side. */
export async function loadEditorPageStyle(): Promise<FirmPageStyle> {
  const s = await getDocumentStyle();
  const logo = logoRefOf(s);
  return {
    values: {
      fontKey: s.fontKey,
      fontSizeHalfPt: s.fontSizeHalfPt,
      lineSpacing: s.lineSpacing,
      spaceAfterPt: s.spaceAfterPt,
      marginTopIn: s.marginTopIn,
      marginRightIn: s.marginRightIn,
      marginBottomIn: s.marginBottomIn,
      marginLeftIn: s.marginLeftIn,
      letterheadBlockId: s.letterheadBlockId,
      logoPosition: s.logoPosition,
      continuationBlockId: s.continuationBlockId,
      pageNumbers: s.pageNumbers,
      paragraphStyles: s.paragraphStyles,
    },
    logo,
    logoUrl: logo ? logoPreviewUrl(s.updatedAt.toISOString()) : null,
  };
}

const num = (d: { toNumber(): number } | null) => (d === null ? null : d.toNumber());

/** Active court formats (values + replacement blocks) for the editor's
 *  "Preview as". Firm config, no record data. */
export async function loadEditorCourtFormats(): Promise<SerializedCourtContext[]> {
  const rows = await prisma.courtFormat.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      blocks: {
        include: {
          replacementBlock: { select: { id: true, name: true, isActive: true, content: true } },
        },
      },
    },
  });
  return rows.map((f) => {
    const values: CourtFormatValues = {
      fontKey: f.fontKey as FontKey | null,
      fontSizeHalfPt: f.fontSizeHalfPt,
      lineSpacing: f.lineSpacing as CourtFormatValues["lineSpacing"],
      spaceAfterPt: f.spaceAfterPt,
      marginTopIn: num(f.marginTopIn),
      marginRightIn: num(f.marginRightIn),
      marginBottomIn: num(f.marginBottomIn),
      marginLeftIn: num(f.marginLeftIn),
      pageNumbers: f.pageNumbers as CourtFormatValues["pageNumbers"],
      paperSize: f.paperSize as CourtFormatValues["paperSize"],
      styleOverrides: readStyleOverrides(f.styleOverrides, f),
    };
    const replacements = new Map<string, BlockSource>();
    for (const b of f.blocks) {
      replacements.set(b.blockId, {
        ...b.replacementBlock,
        content: b.replacementBlock.content as unknown as TemplateDoc,
      });
    }
    return toSerializedCourt({
      id: f.id,
      name: f.name,
      isActive: f.isActive,
      values,
      replacements,
    });
  });
}
