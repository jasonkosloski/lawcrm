/**
 * Firm document style server action.
 *
 * Saves the house style (font, spacing, margins, letterhead and
 * continuation blocks, page numbers). The logo is NOT saved here —
 * its bytes go through /api/document-style/logo (ADR-034).
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { logTemplateChange } from "@/lib/template-activity";
import { DOCUMENT_STYLE_STALE, getDocumentStyle } from "@/lib/templates/document-style";
import {
  FONT_KEYS,
  FONT_SIZE_HALF_PT_MAX,
  FONT_SIZE_HALF_PT_MIN,
  LINE_SPACINGS,
  LOGO_POSITIONS,
  MARGIN_IN_MAX,
  MARGIN_IN_MIN,
  PAGE_NUMBER_POSITIONS,
  SPACE_AFTER_PT_MAX,
  SPACE_AFTER_PT_MIN,
  type DocumentStyleValues,
} from "@/lib/templates/page-style";

const STALE = DOCUMENT_STYLE_STALE;

const margin = z
  .number()
  .min(MARGIN_IN_MIN, "Margins must be between 0.50 and 2.00 inches.")
  .max(MARGIN_IN_MAX, "Margins must be between 0.50 and 2.00 inches.")
  .refine((n) => Math.round(n * 100) / 100 === n, "Margins can have at most 2 decimals.");

const styleSchema = z.object({
  fontKey: z.enum(FONT_KEYS),
  fontSizeHalfPt: z
    .number()
    .int()
    .min(FONT_SIZE_HALF_PT_MIN, "Font size must be 10-14 pt.")
    .max(FONT_SIZE_HALF_PT_MAX, "Font size must be 10-14 pt."),
  lineSpacing: z.enum(LINE_SPACINGS),
  spaceAfterPt: z
    .number()
    .int()
    .min(SPACE_AFTER_PT_MIN, "Space after must be 0-24 pt.")
    .max(SPACE_AFTER_PT_MAX, "Space after must be 0-24 pt."),
  marginTopIn: margin,
  marginRightIn: margin,
  marginBottomIn: margin,
  marginLeftIn: margin,
  letterheadBlockId: z.string().min(1).nullable(),
  logoPosition: z.enum(LOGO_POSITIONS),
  continuationBlockId: z.string().min(1).nullable(),
  pageNumbers: z.enum(PAGE_NUMBER_POSITIONS),
  expectedUpdatedAt: z.string().datetime({ message: "Invalid save timestamp — reload." }),
});

type Result = { ok: true; updatedAt: string } | { ok: false; error: string };

export async function saveDocumentStyle(
  input: DocumentStyleValues & { expectedUpdatedAt: string },
): Promise<Result> {
  const userId = await requirePermission("firm.edit_document_style");
  const parsed = styleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid document style." };
  }
  const { expectedUpdatedAt, ...values } = parsed.data;

  const blockIds = [values.letterheadBlockId, values.continuationBlockId].filter(
    (id): id is string => id !== null,
  );
  if (blockIds.length > 0) {
    const found = await prisma.templateBlock.findMany({
      where: { id: { in: blockIds } },
      select: { id: true },
    });
    if (found.length !== new Set(blockIds).size) {
      return { ok: false, error: "That block no longer exists — reload." };
    }
  }

  const current = await getDocumentStyle();
  const updatedAt = new Date();
  const { count } = await prisma.documentStyle.updateMany({
    where: { id: current.id, updatedAt: new Date(expectedUpdatedAt) },
    data: { ...values, updatedAt },
  });
  if (count === 0) return { ok: false, error: STALE };

  await logTemplateChange(userId, "Document style updated", null);
  revalidatePath("/settings/documents");
  revalidatePath("/settings/templates");
  return { ok: true, updatedAt: updatedAt.toISOString() };
}
