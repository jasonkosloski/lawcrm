/**
 * Template block library server actions.
 *
 * Blocks are reusable structured fragments (ProseMirror JSON) that
 * templates reference by id. They share the template permission keys:
 * create / edit (also archive) / delete. Reading usage needs only a
 * signed-in user — the library is viewable by everyone.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logTemplateChange } from "@/lib/template-activity";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { MAX_TEMPLATE_DESCRIPTION, MAX_TEMPLATE_NAME } from "@/lib/template-constants";
import { collectBlockIds } from "@/lib/templates/inspect";
import { validateTemplateContent, type TemplateDoc } from "@/lib/templates/schema";

type Result = { ok: true; id: string; updatedAt: string } | { ok: false; error: string };

const KEY_TAKEN = "That key is already used by another block.";
const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

const blockSchema = z.object({
  id: z.string().min(1).optional(),
  key: z.string().regex(KEY_RE, "Key must be 2-40 lowercase letters, digits or underscores."),
  name: z.string().trim().min(1, "Name is required.").max(MAX_TEMPLATE_NAME),
  description: z.string().trim().max(MAX_TEMPLATE_DESCRIPTION).optional(),
  expectedUpdatedAt: z
    .string()
    .datetime({ message: "Invalid save timestamp — reload." })
    .optional(),
});

/** Templates (active and archived) whose content references the block. */
async function usageOf(blockId: string): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.documentTemplate.findMany({
    where: { content: { not: Prisma.DbNull } },
    select: { id: true, name: true, content: true },
    orderBy: { name: "asc" },
  });
  return rows
    .filter((t) => collectBlockIds(t.content as unknown as TemplateDoc).includes(blockId))
    .map((t) => ({ id: t.id, name: t.name }));
}

/** Court formats (either side of a replacement) that use the block. */
async function courtFormatsUsing(blockId: string): Promise<{ id: string; name: string }[]> {
  return prisma.courtFormat.findMany({
    where: { blocks: { some: { OR: [{ blockId }, { replacementBlockId: blockId }] } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

const courtFormatsInUse = (formats: { name: string }[]) =>
  `This block is used by court format(s): ${formats.map((f) => f.name).join(", ")}. Remove it there first.`;

export type BlockUsage = { id: string; name: string; kind: "template" | "court_format" };

/** Everything that references the block: templates, then court formats. */
export async function listBlockUsage(blockId: string): Promise<BlockUsage[]> {
  await requireUser();
  const [templates, formats] = await Promise.all([usageOf(blockId), courtFormatsUsing(blockId)]);
  return [
    ...templates.map((t) => ({ ...t, kind: "template" as const })),
    ...formats.map((f) => ({ ...f, kind: "court_format" as const })),
  ];
}

export async function saveTemplateBlock(input: {
  id?: string;
  key: string;
  name: string;
  description?: string;
  content: unknown;
  expectedUpdatedAt?: string;
}): Promise<Result> {
  const userId = await requirePermission(
    input.id ? "documents.template.edit" : "documents.template.create",
  );
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid block." };
  }
  const v = validateTemplateContent("letter", input.content, { isBlock: true });
  if (!v.ok) return { ok: false, error: v.error };

  const { key, name } = parsed.data;
  const description = parsed.data.description?.trim() || null;
  const content = v.doc as unknown as Prisma.InputJsonValue;

  const clash = await prisma.templateBlock.findFirst({
    where: { key, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash) return { ok: false, error: KEY_TAKEN };

  if (!input.id) {
    let created: { id: string; updatedAt: Date };
    try {
      created = await prisma.templateBlock.create({
        data: { key, name, description, content, createdById: userId },
        select: { id: true, updatedAt: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) return { ok: false, error: KEY_TAKEN };
      throw e;
    }
    await logTemplateChange(userId, `Block "${name}" created`, `Key: ${key} (id ${created.id})`);
    revalidatePath("/settings/templates");
    return { ok: true, id: created.id, updatedAt: created.updatedAt.toISOString() };
  }

  const existing = await prisma.templateBlock.findUnique({
    where: { id: input.id },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Block not found." };

  // Set explicitly so the new version can be handed back to the editor.
  const updatedAt = new Date();
  let count: number;
  try {
    ({ count } = await prisma.templateBlock.updateMany({
      where: {
        id: input.id,
        ...(parsed.data.expectedUpdatedAt
          ? { updatedAt: new Date(parsed.data.expectedUpdatedAt) }
          : {}),
      },
      data: { key, name, description, content, updatedAt },
    }));
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: KEY_TAKEN };
    throw e;
  }
  if (count === 0) {
    return { ok: false, error: "Someone else saved this block — reload to see their changes." };
  }
  await logTemplateChange(userId, `Block "${name}" updated`, `Key: ${key} (id ${input.id})`);
  revalidatePath("/settings/templates");
  return { ok: true, id: input.id, updatedAt: updatedAt.toISOString() };
}

/** Archive (false) or restore (true). Archiving is refused while a court
 *  format uses the block (filings would print the archived marker);
 *  templates may still reference an archived block. */
export async function setTemplateBlockActive(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requirePermission("documents.template.edit");
  const existing = await prisma.templateBlock.findUnique({
    where: { id },
    select: { name: true, isActive: true },
  });
  if (!existing) return { ok: false, error: "Block not found." };
  if (!active) {
    const formats = await courtFormatsUsing(id);
    if (formats.length > 0) return { ok: false, error: courtFormatsInUse(formats) };
  }
  await prisma.templateBlock.update({ where: { id }, data: { isActive: active } });
  if (existing.isActive !== active) {
    await logTemplateChange(
      userId,
      `Block "${existing.name}" ${active ? "restored" : "archived"}`,
      null,
    );
  }
  revalidatePath("/settings/templates");
  return { ok: true };
}

/** HARD delete, refused while any template references the block.
 *  Templates reference blocks by JSON id (no FK), so a template saved
 *  concurrently with this delete can still point at the removed block.
 *  That degrades visibly: the render engine shows `[Missing block]`
 *  and reports it. Accepted by design. */
export async function deleteTemplateBlock(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requirePermission("documents.template.delete");
  const existing = await prisma.templateBlock.findUnique({
    where: { id },
    select: { name: true, key: true },
  });
  if (!existing) return { ok: false, error: "Block not found." };
  const formats = await courtFormatsUsing(id);
  if (formats.length > 0) return { ok: false, error: courtFormatsInUse(formats) };
  const styleUse = await prisma.documentStyle.count({
    where: { OR: [{ letterheadBlockId: id }, { continuationBlockId: id }] },
  });
  if (styleUse > 0) {
    return {
      ok: false,
      error: "This block is used by the firm's document style. Choose another block there first.",
    };
  }
  const used = await usageOf(id);
  if (used.length > 0) {
    return {
      ok: false,
      error: `This block is used by: ${used.map((u) => u.name).join(", ")}. Archive it instead, or remove it from those templates first.`,
    };
  }
  await prisma.templateBlock.delete({ where: { id } });
  await logTemplateChange(userId, `Block "${existing.name}" deleted`, `Key: ${existing.key}`);
  revalidatePath("/settings/templates");
  return { ok: true };
}
