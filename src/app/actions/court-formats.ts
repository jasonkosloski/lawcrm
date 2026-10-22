/**
 * Court format server actions.
 *
 * A court format overrides the house style's layout (and swaps blocks)
 * for filings in venues that use it. Null layout values keep the house
 * value. Replacement rows are replaced wholesale with the format update,
 * in one transaction, behind an atomic stale check.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { logSettingsChange } from "@/lib/audit-entry";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { MAX_TEMPLATE_NAME } from "@/lib/template-constants";
import {
  COURT_SYSTEMS,
  FONT_KEYS,
  FONT_SIZE_HALF_PT_MAX,
  FONT_SIZE_HALF_PT_MIN,
  LINE_SPACINGS,
  MARGIN_IN_MAX,
  MARGIN_IN_MIN,
  PAGE_NUMBER_POSITIONS,
  PAPER_SIZES,
  SPACE_AFTER_PT_MAX,
  SPACE_AFTER_PT_MIN,
} from "@/lib/templates/page-style";

const STALE = "Someone else saved this court format — reload to see their changes.";
const NAME_TAKEN = "A court format with that name already exists.";
const SELF = "A block can't replace itself.";
const DUPLICATE = "Each block can be replaced only once per court format.";

const margin = z
  .number()
  .min(MARGIN_IN_MIN, "Margins must be between 0.50 and 2.00 inches.")
  .max(MARGIN_IN_MAX, "Margins must be between 0.50 and 2.00 inches.")
  .refine((n) => Math.round(n * 100) / 100 === n, "Margins can have at most 2 decimals.")
  .nullable();

const schema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, "Name is required.").max(MAX_TEMPLATE_NAME),
  courtSystem: z.enum(COURT_SYSTEMS),
  fontKey: z.enum(FONT_KEYS).nullable(),
  fontSizeHalfPt: z
    .number()
    .int()
    .min(FONT_SIZE_HALF_PT_MIN, "Font size must be 10-14 pt.")
    .max(FONT_SIZE_HALF_PT_MAX, "Font size must be 10-14 pt.")
    .nullable(),
  lineSpacing: z.enum(LINE_SPACINGS).nullable(),
  spaceAfterPt: z
    .number()
    .int()
    .min(SPACE_AFTER_PT_MIN, "Space after must be 0-24 pt.")
    .max(SPACE_AFTER_PT_MAX, "Space after must be 0-24 pt.")
    .nullable(),
  marginTopIn: margin,
  marginRightIn: margin,
  marginBottomIn: margin,
  marginLeftIn: margin,
  pageNumbers: z.enum(PAGE_NUMBER_POSITIONS).nullable(),
  paperSize: z.enum(PAPER_SIZES),
  replacements: z.array(
    z.object({ blockId: z.string().min(1), replacementBlockId: z.string().min(1) }),
  ),
  expectedUpdatedAt: z
    .string()
    .datetime({ message: "Invalid save timestamp — reload." })
    .optional(),
});

export type CourtFormatInput = z.input<typeof schema>;
type SaveResult = { ok: true; id: string; updatedAt: string } | { ok: false; error: string };

class StaleError extends Error {}

function revalidate() {
  revalidatePath("/settings/court-formats");
  revalidatePath("/settings/venues");
}

export async function saveCourtFormat(input: CourtFormatInput): Promise<SaveResult> {
  const userId = await requirePermission(input.id ? "court_formats.edit" : "court_formats.add");
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid court format." };
  }
  const { id, expectedUpdatedAt, replacements, ...values } = parsed.data;
  if (id && !expectedUpdatedAt) return { ok: false, error: "Invalid save timestamp — reload." };

  const seen = new Set<string>();
  for (const r of replacements) {
    if (r.blockId === r.replacementBlockId) return { ok: false, error: SELF };
    if (seen.has(r.blockId)) return { ok: false, error: DUPLICATE };
    seen.add(r.blockId);
  }
  const blockIds = [...new Set(replacements.flatMap((r) => [r.blockId, r.replacementBlockId]))];
  if (blockIds.length > 0) {
    const found = await prisma.templateBlock.count({ where: { id: { in: blockIds } } });
    if (found !== blockIds.length) {
      return { ok: false, error: "That block no longer exists — reload." };
    }
  }

  if (!id) {
    try {
      const created = await prisma.courtFormat.create({
        data: { ...values, blocks: { create: replacements } },
        select: { id: true, updatedAt: true },
      });
      await logSettingsChange(userId, `Court format "${values.name}" created`);
      revalidate();
      return { ok: true, id: created.id, updatedAt: created.updatedAt.toISOString() };
    } catch (e) {
      if (isUniqueViolation(e)) return { ok: false, error: NAME_TAKEN };
      throw e;
    }
  }

  const updatedAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.courtFormat.updateMany({
        where: { id, updatedAt: new Date(expectedUpdatedAt!) },
        data: { ...values, updatedAt },
      });
      if (count === 0) throw new StaleError();
      await tx.courtFormatBlock.deleteMany({ where: { courtFormatId: id } });
      if (replacements.length > 0) {
        await tx.courtFormatBlock.createMany({
          data: replacements.map((r) => ({ ...r, courtFormatId: id })),
        });
      }
    });
  } catch (e) {
    if (e instanceof StaleError) return { ok: false, error: STALE };
    if (isUniqueViolation(e)) return { ok: false, error: NAME_TAKEN };
    throw e;
  }
  await logSettingsChange(userId, `Court format "${values.name}" updated`);
  revalidate();
  return { ok: true, id, updatedAt: updatedAt.toISOString() };
}

/** Archive (false) or restore (true). Allowed while venues use it. */
export async function setCourtFormatActive(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requirePermission("court_formats.edit");
  const row = await prisma.courtFormat.findUnique({
    where: { id },
    select: { name: true, isActive: true },
  });
  if (!row) return { ok: false, error: "Court format not found." };
  if (row.isActive !== active) {
    await prisma.courtFormat.update({ where: { id }, data: { isActive: active } });
    await logSettingsChange(
      userId,
      `Court format "${row.name}" ${active ? "restored" : "archived"}`,
    );
  }
  revalidate();
  return { ok: true };
}

/** HARD delete, refused while any venue (active or archived) uses it. */
export async function deleteCourtFormat(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requirePermission("court_formats.delete");
  const row = await prisma.courtFormat.findUnique({ where: { id }, select: { name: true } });
  if (!row) return { ok: false, error: "Court format not found." };
  const venues = await prisma.venue.findMany({
    where: { courtFormatId: id },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  if (venues.length > 0) {
    return {
      ok: false,
      error: `This court format is used by: ${venues.map((v) => v.name).join(", ")}. Archive it instead, or move those venues first.`,
    };
  }
  await prisma.courtFormat.delete({ where: { id } });
  await logSettingsChange(userId, `Court format "${row.name}" deleted`);
  revalidate();
  return { ok: true };
}
