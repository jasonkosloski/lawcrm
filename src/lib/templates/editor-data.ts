/**
 * Server-side loaders for the template and block editor pages. Callers
 * authenticate first (ADR-028); these only read.
 */

import { prisma } from "@/lib/prisma";
import { getDocumentStyle } from "./document-style";
import { logoPreviewUrl, logoRefOf, type FirmPageStyle } from "./page-render";
import type { BlockSource } from "./render";
import type { AppliesTo, TemplateDoc, TemplateKind } from "./schema";

/** Every block (active and archived) with content, for rendering refs. */
export async function loadBlockSources(): Promise<BlockSource[]> {
  const rows = await prisma.templateBlock.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true, content: true },
  });
  return rows.map((r) => ({ ...r, content: r.content as unknown as TemplateDoc }));
}

export async function loadEditorTemplate(id: string) {
  const t = await prisma.documentTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
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
    select: { id: true, key: true, name: true, description: true, content: true, updatedAt: true },
  });
  if (!b) return null;
  return {
    ...b,
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
    },
    logo,
    logoUrl: logo ? logoPreviewUrl(s.updatedAt.toISOString()) : null,
  };
}
