/**
 * Firm document style server action.
 *
 * Saves the house style (font, margins, letterhead and continuation
 * blocks, page numbers) and, separately, the named paragraph styles
 * (Settings -> Styles). Body's size and spacing live in the paragraph
 * styles; the legacy columns are written only by saveParagraphStyles. The logo is NOT saved here —
 * its bytes go through /api/document-style/logo (ADR-034).
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { logTemplateChange } from "@/lib/template-activity";
import { paragraphStylesSchema, type ParagraphStyle } from "@/lib/templates/paragraph-styles";
import { styleUsageMap } from "@/lib/templates/style-usage";
import { DOCUMENT_STYLE_STALE, getDocumentStyle } from "@/lib/templates/document-style";
import {
  FONT_KEYS,
  LOGO_POSITIONS,
  MARGIN_IN_MAX,
  MARGIN_IN_MIN,
  PAGE_NUMBER_POSITIONS,
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Caption is used by 3 templates: A, B, C." (blocks appended when any). */
function usageMessage(name: string, u: { templates: string[]; blocks: string[] }): string {
  const parts = [
    u.templates.length > 0 &&
      `${plural(u.templates.length, "template")}: ${u.templates.join(", ")}`,
    u.blocks.length > 0 && `${plural(u.blocks.length, "block")}: ${u.blocks.join(", ")}`,
  ].filter(Boolean);
  return `${name} is used by ${parts.join(" and ")}.`;
}

const stylesInput = z.object({
  styles: z.array(z.unknown()),
  expectedUpdatedAt: z.string().datetime({ message: "Invalid save timestamp — reload." }),
});

/** Saves the firm's whole paragraph style list in one go. */
export async function saveParagraphStyles(input: {
  styles: ParagraphStyle[];
  expectedUpdatedAt: string;
}): Promise<Result> {
  const userId = await requirePermission("firm.edit_document_style");
  const head = stylesInput.safeParse(input);
  if (!head.success) {
    return { ok: false, error: head.error.issues[0]?.message ?? "Invalid styles." };
  }

  const current = await getDocumentStyle();
  const submittedKeys = new Set(
    head.data.styles
      .map((s) => (s as { key?: unknown } | null)?.key)
      .filter((k) => typeof k === "string"),
  );
  // Say which built-in went missing before the generic schema message does.
  for (const s of current.paragraphStyles) {
    if (s.builtIn && !submittedKeys.has(s.key)) {
      return { ok: false, error: `${s.name} can't be deleted.` };
    }
  }

  const parsed = paragraphStylesSchema.safeParse(head.data.styles);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid styles." };
  }
  const styles = parsed.data as ParagraphStyle[];

  const removed = current.paragraphStyles.filter((s) => !s.builtIn && !submittedKeys.has(s.key));
  if (removed.length > 0) {
    const usage = await styleUsageMap();
    for (const old of removed) {
      const u = usage.get(old.key);
      if (u) return { ok: false, error: usageMessage(old.name, u) };
    }
  }

  // Keep the legacy columns in step with Body for code paths that still
  // read them (court format fallbacks). Exact line spacing has no legacy
  // equivalent, so that column is left alone.
  const body = styles.find((s) => s.key === "body")!;
  const legacy: { fontSizeHalfPt: number; spaceAfterPt: number; lineSpacing?: string } = {
    fontSizeHalfPt: Math.round(body.values.sizePt * 2),
    spaceAfterPt: Math.round(body.values.spaceAfterPt),
  };
  if (typeof body.values.lineSpacing === "string") legacy.lineSpacing = body.values.lineSpacing;

  const updatedAt = new Date();
  const { count } = await prisma.documentStyle.updateMany({
    where: { id: current.id, updatedAt: new Date(head.data.expectedUpdatedAt) },
    data: { paragraphStyles: styles as never, ...legacy, updatedAt },
  });
  if (count === 0) return { ok: false, error: STALE };

  await logTemplateChange(userId, "Paragraph styles updated", null);
  revalidatePath("/settings/documents");
  revalidatePath("/settings/templates");
  return { ok: true, updatedAt: updatedAt.toISOString() };
}
