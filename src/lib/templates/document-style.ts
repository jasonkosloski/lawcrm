/**
 * Firm document style loading — server-only. Reads (lazily creating) the
 * current firm's DocumentStyle row and loads its logo bytes from storage.
 */

import { getCurrentFirm } from "@/lib/firm";
import { readStoredFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import {
  LOGO_MAX_BYTES,
  type DocumentStyleValues,
  type LoadedLogo,
  type FontKey,
  type LineSpacing,
  type LogoPosition,
  type PageNumberPosition,
} from "./page-style";

export type LoadedDocumentStyle = DocumentStyleValues & {
  id: string;
  updatedAt: Date;
  logoKey: string | null;
  logoContentType: string | null;
};

const LETTERHEAD_BLOCK_ID = "tplblock_letterhead";
const CONTINUATION_BLOCK_ID = "tplblock_continuation";
export const LOGO_WARNING = "Logo couldn't be loaded.";

async function readRow(firmId: string) {
  return prisma.documentStyle.findUnique({ where: { firmId } });
}

type Row = NonNullable<Awaited<ReturnType<typeof readRow>>>;

function toValues(row: Row): LoadedDocumentStyle {
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    fontKey: row.fontKey as FontKey,
    fontSizeHalfPt: row.fontSizeHalfPt,
    lineSpacing: row.lineSpacing as LineSpacing,
    spaceAfterPt: row.spaceAfterPt,
    marginTopIn: Number(row.marginTopIn),
    marginRightIn: Number(row.marginRightIn),
    marginBottomIn: Number(row.marginBottomIn),
    marginLeftIn: Number(row.marginLeftIn),
    letterheadBlockId: row.letterheadBlockId,
    logoPosition: row.logoPosition as LogoPosition,
    logoKey: row.logoKey,
    logoContentType: row.logoContentType,
    continuationBlockId: row.continuationBlockId,
    pageNumbers: row.pageNumbers as PageNumberPosition,
  };
}

/** The current firm's house style, created with defaults on first read. */
export async function getDocumentStyle(): Promise<LoadedDocumentStyle> {
  const firm = await getCurrentFirm();
  const existing = await readRow(firm.id);
  if (existing) return toValues(existing);

  const blocks = await prisma.templateBlock.findMany({
    where: { id: { in: [LETTERHEAD_BLOCK_ID, CONTINUATION_BLOCK_ID] } },
    select: { id: true },
  });
  const have = new Set(blocks.map((b) => b.id));
  const create = {
    firmId: firm.id,
    letterheadBlockId: have.has(LETTERHEAD_BLOCK_ID) ? LETTERHEAD_BLOCK_ID : null,
    continuationBlockId: have.has(CONTINUATION_BLOCK_ID) ? CONTINUATION_BLOCK_ID : null,
  };
  try {
    const row = await prisma.documentStyle.upsert({
      where: { firmId: firm.id },
      create,
      update: {},
    });
    return toValues(row);
  } catch (err) {
    // Concurrent first reads can still race into the unique index.
    if (!isUniqueViolation(err)) throw err;
    const row = await readRow(firm.id);
    if (!row) throw err;
    return toValues(row);
  }
}

/** Loads the logo bytes. Any failure is a warning, never an error. */
export async function loadLogo(
  style: Pick<LoadedDocumentStyle, "logoKey" | "logoContentType" | "logoPosition">,
): Promise<{ logo: LoadedLogo | null; warning: string | null }> {
  const { logoKey, logoContentType, logoPosition } = style;
  if (logoPosition === "none" || !logoKey || !logoContentType) {
    return { logo: null, warning: null };
  }
  const failed = { logo: null, warning: LOGO_WARNING };
  if (logoContentType !== "image/png" && logoContentType !== "image/jpeg") return failed;
  try {
    const buf = await readStoredFile(logoKey, LOGO_MAX_BYTES + 1);
    if (!buf || buf.length > LOGO_MAX_BYTES) return failed;
    return {
      logo: {
        bytes: new Uint8Array(buf),
        contentType: logoContentType,
        position: logoPosition,
      },
      warning: null,
    };
  } catch {
    return failed;
  }
}
