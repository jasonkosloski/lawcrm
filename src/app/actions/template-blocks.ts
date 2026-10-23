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
import { prisma, type Tx } from "@/lib/prisma";
import { requireUser } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logTemplateChange } from "@/lib/template-activity";
import { isTransactionTimeout, isUniqueViolation } from "@/lib/prisma-errors";
import { MAX_TEMPLATE_DESCRIPTION, MAX_TEMPLATE_NAME } from "@/lib/template-constants";
import {
  childIds,
  depthAbove,
  height,
  loopPath,
  MAX_BLOCK_DEPTH,
  SCOPE_WORD,
  scopeCovers,
} from "@/lib/templates/block-graph";
import {
  childrenError,
  BLOCK_GRAPH_BUSY,
  BLOCK_GRAPH_TX,
  loadAllBlocks,
  lockBlockGraph,
  TOO_DEEP,
} from "@/lib/templates/block-graph-db";
import { checkTemplateFit, collectBlockIds } from "@/lib/templates/inspect";
import type { BlockSource } from "@/lib/templates/render";
import {
  APPLIES_TO,
  validateTemplateContent,
  type AppliesTo,
  type TemplateDoc,
} from "@/lib/templates/schema";

type Result = { ok: true; id: string; updatedAt: string } | { ok: false; error: string };

const KEY_TAKEN = "That key is already used by another block.";
const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

const blockSchema = z.object({
  id: z.string().min(1).optional(),
  key: z.string().regex(KEY_RE, "Key must be 2-40 lowercase letters, digits or underscores."),
  name: z.string().trim().min(1, "Name is required.").max(MAX_TEMPLATE_NAME),
  description: z.string().trim().max(MAX_TEMPLATE_DESCRIPTION).optional(),
  appliesTo: z.enum(APPLIES_TO).optional(),
  expectedUpdatedAt: z
    .string()
    .datetime({ message: "Invalid save timestamp — reload." })
    .optional(),
});

type Parent = { id: string; name: string; appliesTo: AppliesTo };

const referencing = <T extends { content: Prisma.JsonValue }>(rows: T[], blockId: string) =>
  rows.filter((r) => collectBlockIds(r.content as unknown as TemplateDoc).includes(blockId));

/** Templates (active and archived) whose content references the block. */
async function usageOf(
  blockId: string,
  db: Pick<Tx, "documentTemplate"> = prisma,
): Promise<Parent[]> {
  const rows = await db.documentTemplate.findMany({
    where: { content: { not: Prisma.DbNull } },
    select: { id: true, name: true, appliesTo: true, content: true },
    orderBy: { name: "asc" },
  });
  return referencing(rows, blockId).map((t) => ({
    id: t.id,
    name: t.name,
    appliesTo: t.appliesTo as AppliesTo,
  }));
}

/** Blocks (active and archived) whose content references the block directly. */
async function parentBlocksOf(blockId: string): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.templateBlock.findMany({
    where: { id: { not: blockId } },
    select: { id: true, name: true, content: true },
    orderBy: { name: "asc" },
  });
  return referencing(rows, blockId).map((b) => ({ id: b.id, name: b.name }));
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

export type BlockUsage = {
  id: string;
  name: string;
  kind: "template" | "block" | "court_format";
};

/** Everything that references the block: templates, then parent blocks,
 *  then court formats. */
export async function listBlockUsage(blockId: string): Promise<BlockUsage[]> {
  await requireUser();
  const [templates, blocks, formats] = await Promise.all([
    usageOf(blockId),
    parentBlocksOf(blockId),
    courtFormatsUsing(blockId),
  ]);
  return [
    ...templates.map((t) => ({ id: t.id, name: t.name, kind: "template" as const })),
    ...blocks.map((b) => ({ ...b, kind: "block" as const })),
    ...formats.map((f) => ({ ...f, kind: "court_format" as const })),
  ];
}

/** Placeholder id for a block being created, so the graph helpers can
 *  walk its content (nothing can reference it yet). */
const NEW_BLOCK = "\u0000new";

/** The nesting rules for saving `doc` as block `selfId` with `scope`,
 *  checked against the stored graph (`blocks`, already holding the new
 *  content): missing child, child scope (rule 2), loop, depth, then
 *  parents broader than the new scope (rule 3). */
async function graphError(
  tx: Tx,
  selfId: string,
  name: string,
  doc: TemplateDoc,
  scope: AppliesTo,
  blocks: Map<string, BlockSource>,
): Promise<string | null> {
  const childError = childrenError(childIds(doc), blocks, scope, "block");
  if (childError) return childError;
  if (selfId !== NEW_BLOCK) {
    const path = loopPath(selfId, doc, blocks);
    if (path && path.length === 0) return `${name} can't include itself.`;
    if (path) {
      const a = blocks.get(path[0])!.name;
      return `${a} already includes ${name}, so ${name} can't include ${a}.`;
    }
  }
  if (depthAbove(selfId, blocks) + height(selfId, blocks) > MAX_BLOCK_DEPTH) return TOO_DEEP;
  if (selfId === NEW_BLOCK || scope === "both") return null;
  const parentBlocks = [...blocks.values()].filter(
    (b) => b.id !== selfId && childIds(b.content).includes(selfId),
  );
  const parents: Parent[] = [
    ...(await usageOf(selfId, tx)),
    ...parentBlocks.map((b) => ({ id: b.id, name: b.name, appliesTo: b.appliesTo ?? "both" })),
  ];
  const broader = parents.find((p) => !scopeCovers(scope, p.appliesTo));
  return broader
    ? `${broader.name} applies to ${SCOPE_WORD[broader.appliesTo]} and uses this block — change it first.`
    : null;
}

export async function saveTemplateBlock(input: {
  id?: string;
  key: string;
  name: string;
  description?: string;
  /** Absent: unchanged on update, "both" on create. */
  appliesTo?: AppliesTo;
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
  const STALE = "Someone else saved this block — reload to see their changes.";

  // Graph rules and the write run under the block graph lock, so racing
  // saves see each other's committed content and take turns.
  type Saved = { ok: true; id: string; updatedAt: Date } | { ok: false; error: string };
  let saved: Saved;
  try {
    saved = await prisma.$transaction(async (tx): Promise<Saved> => {
      await lockBlockGraph(tx);
      const blocks = await loadAllBlocks(tx);
      const existing = input.id ? blocks.get(input.id) : undefined;
      if (input.id && !existing) return { ok: false, error: "Block not found." };
      // Absent scope: keep the stored one on update, "both" on create.
      const scope = parsed.data.appliesTo ?? existing?.appliesTo ?? "both";

      // Rule 1: the block's own fields must fit its scope.
      const fit = checkTemplateFit(v.doc, scope);
      if (!fit.ok) {
        const names = fit.invalid.map((i) => i.label ?? i.path).join(", ");
        return {
          ok: false,
          error: `These fields don't fit a ${SCOPE_WORD[scope]} block: ${names}.`,
        };
      }

      const selfId = input.id ?? NEW_BLOCK;
      blocks.set(selfId, {
        id: selfId,
        name,
        isActive: existing?.isActive ?? true,
        content: v.doc,
        appliesTo: scope,
      });
      const graph = await graphError(tx, selfId, name, v.doc, scope, blocks);
      if (graph) return { ok: false, error: graph };

      const clash = await tx.templateBlock.findFirst({
        where: { key, ...(input.id ? { id: { not: input.id } } : {}) },
        select: { id: true },
      });
      if (clash) return { ok: false, error: KEY_TAKEN };

      if (!input.id) {
        const created = await tx.templateBlock.create({
          data: { key, name, description, content, appliesTo: scope, createdById: userId },
          select: { id: true, updatedAt: true },
        });
        return { ok: true, ...created };
      }

      // Set explicitly so the new version can be handed back to the editor.
      const updatedAt = new Date();
      const { count } = await tx.templateBlock.updateMany({
        where: {
          id: input.id,
          ...(parsed.data.expectedUpdatedAt
            ? { updatedAt: new Date(parsed.data.expectedUpdatedAt) }
            : {}),
        },
        data: { key, name, description, content, updatedAt, appliesTo: parsed.data.appliesTo },
      });
      return count === 0 ? { ok: false, error: STALE } : { ok: true, id: input.id, updatedAt };
    }, BLOCK_GRAPH_TX);
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: KEY_TAKEN };
    if (isTransactionTimeout(e)) return { ok: false, error: BLOCK_GRAPH_BUSY };
    throw e;
  }
  if (!saved.ok) return saved;

  await logTemplateChange(
    userId,
    `Block "${name}" ${input.id ? "updated" : "created"}`,
    `Key: ${key} (id ${saved.id})`,
  );
  revalidatePath("/settings/templates");
  return { ok: true, id: saved.id, updatedAt: saved.updatedAt.toISOString() };
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

/** HARD delete, refused while any template or block references the block.
 *  Templates and blocks reference blocks by JSON id (no FK), so one saved
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
  const used = [...(await usageOf(id)), ...(await parentBlocksOf(id))];
  if (used.length > 0) {
    return {
      ok: false,
      error: `This block is used by: ${used.map((u) => u.name).join(", ")}. Archive it instead, or remove it from those templates and blocks first.`,
    };
  }
  await prisma.templateBlock.delete({ where: { id } });
  await logTemplateChange(userId, `Block "${existing.name}" deleted`, `Key: ${existing.key}`);
  revalidatePath("/settings/templates");
  return { ok: true };
}
