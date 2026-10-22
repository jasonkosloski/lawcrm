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
import { logActivity } from "@/lib/activity-log";
import { MAX_TEMPLATE_DESCRIPTION, MAX_TEMPLATE_NAME } from "@/lib/template-constants";
import { collectBlockIds } from "@/lib/templates/inspect";
import { validateTemplateContent, type TemplateDoc } from "@/lib/templates/schema";

type Result = { ok: true; id: string } | { ok: false; error: string };

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

const blockSchema = z.object({
  id: z.string().min(1).optional(),
  key: z.string().regex(KEY_RE, "Key must be 2-40 lowercase letters, digits or underscores."),
  name: z.string().trim().min(1, "Name is required.").max(MAX_TEMPLATE_NAME),
  description: z.string().trim().max(MAX_TEMPLATE_DESCRIPTION).optional(),
  expectedUpdatedAt: z.string().optional(),
});

async function logBlockChange(userId: string, title: string, detail: string | null) {
  await logActivity({
    matterId: null,
    userId,
    type: "document",
    title,
    detail,
    source: "Settings",
  });
}

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

export async function listBlockUsage(blockId: string): Promise<{ id: string; name: string }[]> {
  await requireUser();
  return usageOf(blockId);
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
  if (clash) return { ok: false, error: "That key is already used by another block." };

  if (!input.id) {
    const created = await prisma.templateBlock.create({
      data: { key, name, description, content, createdById: userId },
      select: { id: true },
    });
    await logBlockChange(userId, `Block "${name}" created`, `Key: ${key} (id ${created.id})`);
    revalidatePath("/settings/templates");
    return { ok: true, id: created.id };
  }

  const existing = await prisma.templateBlock.findUnique({
    where: { id: input.id },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Block not found." };

  const { count } = await prisma.templateBlock.updateMany({
    where: {
      id: input.id,
      ...(parsed.data.expectedUpdatedAt
        ? { updatedAt: new Date(parsed.data.expectedUpdatedAt) }
        : {}),
    },
    data: { key, name, description, content },
  });
  if (count === 0) {
    return { ok: false, error: "Someone else saved this block — reload to see their changes." };
  }
  await logBlockChange(userId, `Block "${name}" updated`, `Key: ${key} (id ${input.id})`);
  revalidatePath("/settings/templates");
  return { ok: true, id: input.id };
}

/** Archive (false) or restore (true). Allowed while referenced. */
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
  await prisma.templateBlock.update({ where: { id }, data: { isActive: active } });
  if (existing.isActive !== active) {
    await logBlockChange(
      userId,
      `Block "${existing.name}" ${active ? "restored" : "archived"}`,
      null,
    );
  }
  revalidatePath("/settings/templates");
  return { ok: true };
}

/** HARD delete, refused while any template references the block. */
export async function deleteTemplateBlock(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requirePermission("documents.template.delete");
  const existing = await prisma.templateBlock.findUnique({
    where: { id },
    select: { name: true, key: true },
  });
  if (!existing) return { ok: false, error: "Block not found." };
  const used = await usageOf(id);
  if (used.length > 0) {
    return {
      ok: false,
      error: `This block is used by: ${used.map((u) => u.name).join(", ")}. Archive it instead, or remove it from those templates first.`,
    };
  }
  await prisma.templateBlock.delete({ where: { id } });
  await logBlockChange(userId, `Block "${existing.name}" deleted`, `Key: ${existing.key}`);
  revalidatePath("/settings/templates");
  return { ok: true };
}
