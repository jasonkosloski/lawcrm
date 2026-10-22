/**
 * Document-template server actions — library CRUD + generation.
 *
 * Auth model (see docs/PERMISSIONS.md):
 *   - Create:            `documents.template.create`
 *   - Edit + archive/restore: `documents.template.edit` (archive is
 *     just a soft edit of `isActive` — same blast radius as changing
 *     the body, so same key).
 *   - Hard delete:       `documents.template.delete`
 *   - GENERATE onto a matter: `documents.upload` — generation writes
 *     a file + Document row, which is exactly what upload does, so
 *     it borrows upload's key rather than minting a parallel one.
 *   - PREVIEW a merge: also `documents.upload` (plus `records.view`
 *     for a records-request merge). A preview can merge more than a
 *     matter page shows (custodian + request details), so it must
 *     never show more than the user could generate. A denial returns
 *     `{ ok: false, error }` (the dialog is hidden without the key).
 *
 * Generation mirrors `uploadDocument` (src/app/actions/documents.ts,
 * read-only reference): storeFile → Document row → activity log →
 * revalidate. We call `src/lib/file-storage.ts` directly rather than
 * routing through uploadDocument so the reference action stays
 * untouched.
 *
 * Multi-firm: same caveat as documents.ts — matter/template lookups
 * are existence-by-id (no firmId on either model yet). Scope them
 * when multi-tenancy lands.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  assertScopeAccess,
  assertScopeWritable,
  revalidateDocumentScope,
} from "@/lib/scope-access";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { logTemplateChange } from "@/lib/template-activity";
import { deleteFile, storeFile } from "@/lib/file-storage";
import { toUserMessage } from "@/lib/user-facing-error";
import { formatDate } from "@/lib/format-date";
import { resolveRecordsRoleFolder } from "@/lib/records-requests/folder";
import { loadRecordsRequest, loadTemplateData } from "@/lib/templates/load-data";
import { SAMPLE_TEMPLATE_DATA, type TemplateData } from "@/lib/templates/catalog";
import { renderTemplate, type BlockSource, type RenderReport } from "@/lib/templates/render";
import { convertLegacyBody } from "@/lib/templates/legacy";
import { resolvedToHtml } from "@/lib/templates/to-html";
import { resolvedToText } from "@/lib/templates/to-text";
import { resolvedToDocx } from "@/lib/templates/to-docx";
import { Prisma } from "@/generated/prisma/client";
import {
  checkTemplateFit,
  collectBlockIds,
  usesRecipient,
  usesSigner,
} from "@/lib/templates/inspect";
import {
  APPLIES_TO,
  TEMPLATE_KINDS,
  validateSubject,
  validateTemplateContent,
  type AppliesTo,
  type TemplateDoc,
  type TemplateKind,
} from "@/lib/templates/schema";
import {
  MAX_TEMPLATE_DESCRIPTION,
  MAX_TEMPLATE_NAME,
  documentCategoryForTemplate,
  STALE_TEMPLATE,
  isTemplateCategory,
  templateCategoryLabel,
} from "@/lib/template-constants";
import { globalSearch } from "@/lib/queries/search";

// ── Library CRUD ───────────────────────────────────────────────────────

const SCOPE_WORD: Record<AppliesTo, string> = {
  matter: "matter",
  lead: "lead",
  both: "matter-and-lead",
};

const saveTemplateSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, "Name is required.").max(MAX_TEMPLATE_NAME),
  category: z.string().min(1, "Category is required.").max(60),
  description: z.string().trim().max(MAX_TEMPLATE_DESCRIPTION).optional(),
  kind: z.enum(TEMPLATE_KINDS),
  appliesTo: z.enum(APPLIES_TO),
  expectedUpdatedAt: z
    .string()
    .datetime({ message: "Invalid save timestamp — reload." })
    .optional(),
});

/** Structured save (create or update). Content is ProseMirror JSON, so
 *  inputs are plain objects rather than FormData. */
export async function saveDocumentTemplate(input: {
  id?: string;
  name: string;
  category: string;
  description?: string;
  kind: TemplateKind;
  appliesTo: AppliesTo;
  content: unknown;
  subject?: unknown;
  expectedUpdatedAt?: string;
}): Promise<{ ok: true; id: string; updatedAt: string } | { ok: false; error: string }> {
  const userId = await requirePermission(
    input.id ? "documents.template.edit" : "documents.template.create",
  );
  const parsed = saveTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template." };
  }
  const { name, kind, appliesTo } = parsed.data;
  const description = parsed.data.description?.trim() || null;

  const existing = input.id
    ? await prisma.documentTemplate.findUnique({
        where: { id: input.id },
        select: { id: true, category: true },
      })
    : null;
  if (input.id && !existing) return { ok: false, error: "Template not found." };
  if (!isTemplateCategory(parsed.data.category) && parsed.data.category !== existing?.category) {
    return { ok: false, error: "Unknown category." };
  }

  const content = validateTemplateContent(kind, input.content);
  if (!content.ok) return { ok: false, error: content.error };

  let subjectDoc = null;
  if (kind === "email" && input.subject != null) {
    const s = validateSubject(input.subject);
    if (!s.ok) return { ok: false, error: s.error };
    subjectDoc = s.doc;
  }

  const fit = checkTemplateFit(content.doc, appliesTo, subjectDoc);
  if (!fit.ok) {
    const names = fit.invalid.map((i) => i.label ?? i.path).join(", ");
    return {
      ok: false,
      error: `These fields don't fit a ${SCOPE_WORD[appliesTo]} template: ${names}.`,
    };
  }

  const blockIds = collectBlockIds(content.doc);
  if (blockIds.length > 0) {
    const found = await prisma.templateBlock.count({ where: { id: { in: blockIds } } });
    if (found !== blockIds.length) {
      return { ok: false, error: "A referenced block no longer exists." };
    }
  }

  const data = {
    name,
    category: parsed.data.category,
    description,
    kind,
    appliesTo,
    body: null,
    content: content.doc as unknown as Prisma.InputJsonValue,
    subject: subjectDoc ? (subjectDoc as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };

  if (!input.id) {
    const created = await prisma.documentTemplate.create({
      data: { ...data, createdById: userId },
      select: { id: true, updatedAt: true },
    });
    await logTemplateChange(
      userId,
      `Template "${name}" created`,
      `Category: ${templateCategoryLabel(data.category)} (id ${created.id})`,
    );
    revalidatePath("/settings/templates");
    return { ok: true, id: created.id, updatedAt: created.updatedAt.toISOString() };
  }

  // Atomic stale check: the write only matches the row version the
  // editor loaded, so two concurrent saves cannot both win. The new
  // version is set explicitly so it can be handed back to the editor.
  const updatedAt = new Date();
  const { count } = await prisma.documentTemplate.updateMany({
    where: {
      id: input.id,
      ...(parsed.data.expectedUpdatedAt
        ? { updatedAt: new Date(parsed.data.expectedUpdatedAt) }
        : {}),
    },
    data: { ...data, updatedAt },
  });
  if (count === 0) {
    return { ok: false, error: "Someone else saved this template — reload to see their changes." };
  }
  await logTemplateChange(userId, `Template "${name}" updated`, `id ${input.id}`);
  revalidatePath("/settings/templates");
  return { ok: true, id: input.id, updatedAt: updatedAt.toISOString() };
}

/** Archive (isActive=false) or restore (true). Soft state only —
 *  generation pickers hide archived templates, history is intact.
 *  Gated as an EDIT: same firm-wide blast radius, no data loss. */
export async function setDocumentTemplateActive(
  templateId: string,
  isActive: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("documents.template.edit");
  const existing = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, isActive: true },
  });
  if (!existing) return { ok: false, error: "Template not found." };

  await prisma.documentTemplate.update({
    where: { id: templateId },
    data: { isActive },
  });
  if (existing.isActive !== isActive) {
    await logTemplateChange(
      userId,
      `Template "${existing.name}" ${isActive ? "restored" : "archived"}`,
      null,
    );
  }
  revalidatePath("/settings/templates");
  return { ok: true };
}

/** HARD delete — the row is gone. Already-generated documents are
 *  untouched (they're plain Document rows with their own file).
 *  Prefer archive unless the template was a mistake. */
export async function deleteDocumentTemplate(
  templateId: string,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("documents.template.delete");
  const existing = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, category: true },
  });
  if (!existing) return { ok: false, error: "Template not found." };

  await prisma.documentTemplate.delete({ where: { id: templateId } });
  await logTemplateChange(
    userId,
    `Template "${existing.name}" deleted`,
    `Category: ${templateCategoryLabel(existing.category)} (id ${existing.id})`,
  );
  revalidatePath("/settings/templates");
  return { ok: true };
}

// ── Generation ─────────────────────────────────────────────────────────

const REQUEST_NOT_FOUND = "Records request not found.";
const NOT_A_DOCUMENT = "This template can't be saved as a document.";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Kinds that produce a saved document (email and SMS are message drafts). */
const isDocumentKind = (kind: string) => kind === "letter" || kind === "filing";

/** The blocks a doc references, active AND archived (archived ones render
 *  a visible placeholder rather than vanishing). Unknown ids are absent
 *  from the map, which the renderer reports as deleted. */
async function loadBlockMap(doc: TemplateDoc): Promise<Map<string, BlockSource>> {
  const ids = collectBlockIds(doc);
  const map = new Map<string, BlockSource>();
  if (ids.length === 0) return map;
  const rows = await prisma.templateBlock.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, isActive: true, content: true },
  });
  for (const r of rows) map.set(r.id, { ...r, content: r.content as unknown as TemplateDoc });
  return map;
}

/** Structured content, or the legacy `{{token}}` body converted on the fly. */
const contentOf = (t: { content: Prisma.JsonValue | null; body: string | null }): TemplateDoc =>
  t.content ? (t.content as unknown as TemplateDoc) : convertLegacyBody(t.body ?? "");

type GenerateOpts = {
  recordsRequestId?: string;
  signerId?: string;
  recipientContactId?: string;
};

export type TemplatePreviewResult =
  | {
      ok: true;
      templateName: string;
      html: string;
      text: string;
      report: RenderReport;
      templateUpdatedAt: string;
      needsSigner: boolean;
      needsRecipient: boolean;
    }
  | { ok: false; error: string };

/**
 * Render a template against a real record WITHOUT writing anything.
 * Requires the same key as `generateDocumentFromTemplate`
 * (`documents.upload`) so a preview never shows more than the user
 * could produce. `templateUpdatedAt` is handed back so generation can
 * refuse if the template changed after the user reviewed the preview.
 */
export async function previewDocumentFromTemplate(
  templateId: string,
  scope: RecordScope,
  opts?: GenerateOpts,
): Promise<TemplatePreviewResult> {
  await assertScopeAccess(scope);
  if (!(await currentUserHasPermission("documents.upload"))) {
    return {
      ok: false,
      error: "You don't have permission to generate documents from templates.",
    };
  }
  // The rendered text exposes custodian + request details.
  if (opts?.recordsRequestId && !(await currentUserHasPermission("records.view"))) {
    return {
      ok: false,
      error: "You don't have permission to view records requests.",
    };
  }
  const request = opts?.recordsRequestId
    ? await loadRecordsRequest(scope, opts.recordsRequestId)
    : null;
  if (opts?.recordsRequestId && !request) {
    return { ok: false, error: REQUEST_NOT_FOUND };
  }
  const template = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { name: true, kind: true, content: true, body: true, isActive: true, updatedAt: true },
  });
  if (!template || !template.isActive) {
    return { ok: false, error: "Template not found or archived." };
  }
  if (!isDocumentKind(template.kind)) return { ok: false, error: NOT_A_DOCUMENT };

  const doc = contentOf(template);
  const blocks = await loadBlockMap(doc);
  const loaded = await loadTemplateData({
    scope,
    signerId: opts?.signerId,
    recipientContactId: opts?.recipientContactId,
    request,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const { doc: resolved, report } = renderTemplate(doc, { data: loaded.data, blocks });
  return {
    ok: true,
    templateName: template.name,
    html: resolvedToHtml(resolved),
    text: resolvedToText(resolved),
    report,
    templateUpdatedAt: template.updatedAt.toISOString(),
    needsSigner: usesSigner(doc, blocks),
    needsRecipient: usesRecipient(doc, blocks),
  };
}

export type GenerateDocumentResult =
  | { ok: true; documentId: string; documentName: string; report: RenderReport }
  | { ok: false; error: string };

/**
 * Render + SAVE: stores the result as a .docx via the file-storage lib
 * and creates a Document row on the record (source "generated"),
 * mirroring uploadDocument's storage + row + activity shape. Gated on
 * `documents.upload`.
 *
 * Missing/invalid fields do NOT block the save (the caller previews
 * first and placeholders are visible in the output) but the render
 * report is returned so the UI can warn one last time. A template that
 * changed since the preview (`expectedUpdatedAt`) is refused.
 */
export async function generateDocumentFromTemplate(
  templateId: string,
  scope: RecordScope,
  opts: GenerateOpts & { folderId?: string | null; expectedUpdatedAt: string },
): Promise<GenerateDocumentResult> {
  const userId = await requirePermission("documents.upload");
  // Tagging a document to a records request is a records edit.
  if (opts.recordsRequestId) await requirePermission("records.edit");
  await assertScopeAccess(scope);
  const readOnly = await assertScopeWritable(scope);
  if (readOnly) return { ok: false, error: readOnly };
  const request = opts.recordsRequestId
    ? await loadRecordsRequest(scope, opts.recordsRequestId)
    : null;
  if (opts.recordsRequestId && !request) {
    return { ok: false, error: REQUEST_NOT_FOUND };
  }

  const template = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: {
      name: true,
      kind: true,
      content: true,
      body: true,
      category: true,
      isActive: true,
      updatedAt: true,
    },
  });
  if (!template || !template.isActive) {
    return { ok: false, error: "Template not found or archived." };
  }
  if (!isDocumentKind(template.kind)) return { ok: false, error: NOT_A_DOCUMENT };
  if (template.updatedAt.getTime() !== new Date(opts.expectedUpdatedAt).getTime()) {
    return { ok: false, error: STALE_TEMPLATE };
  }

  // Records requests file into their own role folder; otherwise the
  // chosen folder must belong to this very record.
  let folderId: string | null = null;
  if (!request && opts.folderId) {
    const folder = await prisma.documentFolder.findFirst({
      where: { id: opts.folderId, ...scopeWhere(scope) },
      select: { id: true },
    });
    if (!folder) return { ok: false, error: "Folder not found." };
    folderId = folder.id;
  }

  const doc = contentOf(template);
  const blocks = await loadBlockMap(doc);
  const loaded = await loadTemplateData({
    scope,
    signerId: opts.signerId,
    recipientContactId: opts.recipientContactId,
    request,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const { doc: resolved, report } = renderTemplate(doc, { data: loaded.data, blocks });
  const buffer = await resolvedToDocx(resolved);

  // "<template name> — <date>.docx" — the date disambiguates repeat generations.
  const documentName = `${template.name} — ${formatDate(
    loaded.data.today,
    "medium",
    loaded.data.timeZone,
  )}.docx`;

  // Node's global File — same shape uploadDocument receives from the
  // browser. Infrastructure failures (blob 5xx, misconfigured driver,
  // matter deleted mid-request) come back as {ok:false} so the dialog
  // shows an inline error instead of the route error boundary.
  let stored: Awaited<ReturnType<typeof storeFile>>;
  try {
    stored = await storeFile(new File([new Uint8Array(buffer)], documentName, { type: DOCX_MIME }));
  } catch (err) {
    return {
      ok: false,
      error: toUserMessage(
        err,
        "Couldn't save the document — storage is unavailable. Try again.",
        "generateDocumentFromTemplate.storeFile",
      ),
    };
  }

  let created: { id: string };
  try {
    const data = {
      ...scopeWhere(scope),
      name: documentName,
      category: documentCategoryForTemplate(template.category),
      source: "generated" as const,
      fileUrl: stored.key,
      contentType: stored.contentType,
      fileSize: stored.size,
      uploadedBy: userId,
    };
    created = request
      ? await prisma.$transaction(async (tx) => {
          const requestFolderId = await resolveRecordsRoleFolder(
            tx,
            {
              id: request.id,
              matterId: request.matterId,
              leadId: request.leadId,
              custodianName: request.custodian.name,
              typeName: request.type?.name ?? request.adHocTypeName ?? "Records",
            },
            "request_letter",
          );
          return tx.document.create({
            data: {
              ...data,
              folderId: requestFolderId,
              recordsRequestId: request.id,
              recordsRequestRole: "request_letter",
            },
            select: { id: true },
          });
        })
      : await prisma.document.create({ data: { ...data, folderId }, select: { id: true } });
  } catch (err) {
    // The file is already written; no row will ever point at it.
    await deleteFile(stored.key).catch(() => {});
    return {
      ok: false,
      error: toUserMessage(
        err,
        "Couldn't save the document. Try again.",
        "generateDocumentFromTemplate.create",
      ),
    };
  }

  await logActivity({
    matterId: scope.kind === "matter" ? scope.matterId : null,
    leadId: scope.kind === "lead" ? scope.leadId : null,
    userId,
    type: "document",
    title: "Document generated from template",
    detail: `${documentName} (from "${template.name}")`,
  });

  revalidateDocumentScope(scope);
  return { ok: true, documentId: created.id, documentName, report };
}

// ── Editor draft preview ───────────────────────────────────────────────

/** The editor's own keys: anyone who may author templates may preview. */
async function canPreviewDrafts(): Promise<boolean> {
  return (
    (await currentUserHasPermission("documents.template.edit")) ||
    (await currentUserHasPermission("documents.template.create"))
  );
}

const PREVIEW_RECORD_TAKE = 8;

/**
 * Matters and leads to preview a draft against. Wraps `globalSearch`, so
 * the viewer's matter/lead access scoping (ethical walls, restricted
 * leads) applies unchanged. `appliesTo` narrows the kinds searched.
 */
export async function searchTemplatePreviewRecords(
  query: string,
  appliesTo: AppliesTo = "both",
): Promise<{ scope: RecordScope; label: string }[]> {
  if (!(await canPreviewDrafts())) return [];
  const out: { scope: RecordScope; label: string }[] = [];
  if (appliesTo !== "lead") {
    const res = await globalSearch(query, { type: "matter", take: PREVIEW_RECORD_TAKE });
    for (const g of res.groups) {
      for (const h of g.hits)
        out.push({ scope: { kind: "matter", matterId: h.id }, label: h.title });
    }
  }
  if (appliesTo !== "matter") {
    const res = await globalSearch(query, { type: "lead", take: PREVIEW_RECORD_TAKE });
    for (const g of res.groups) {
      for (const h of g.hits) out.push({ scope: { kind: "lead", leadId: h.id }, label: h.title });
    }
  }
  return out;
}

/**
 * Render an unsaved editor draft against sample data or a real record.
 * Gated on template edit/create (the editor's own keys); a real target
 * still goes through the access-checked loader.
 */
export async function previewTemplateDraft(input: {
  content: unknown;
  subject?: unknown;
  kind: TemplateKind;
  appliesTo: AppliesTo;
  target: { sample: true } | { scope: RecordScope };
}): Promise<
  | { ok: true; html: string; text: string; subjectText: string | null; report: RenderReport }
  | { ok: false; error: string }
> {
  if (!(await canPreviewDrafts())) {
    return { ok: false, error: "You don't have permission to preview templates." };
  }

  const content = validateTemplateContent(input.kind, input.content);
  if (!content.ok) return { ok: false, error: content.error };
  let subjectDoc: TemplateDoc | null = null;
  if (input.kind === "email" && input.subject != null) {
    const s = validateSubject(input.subject);
    if (!s.ok) return { ok: false, error: s.error };
    subjectDoc = s.doc;
  }

  const blocks = await loadBlockMap(content.doc);

  let data: TemplateData;
  if ("sample" in input.target) {
    data = {
      ...SAMPLE_TEMPLATE_DATA,
      scope: input.appliesTo === "lead" ? "lead" : "matter",
    };
  } else {
    const loaded = await loadTemplateData({ scope: input.target.scope });
    if (!loaded.ok) return { ok: false, error: loaded.error };
    data = loaded.data;
  }

  const { doc: resolved, report } = renderTemplate(content.doc, { data, blocks });
  let subjectText: string | null = null;
  if (subjectDoc) {
    const rendered = renderTemplate(subjectDoc, { data, blocks });
    subjectText = resolvedToText(rendered.doc);
    for (const k of ["missing", "invalid", "archivedBlocks"] as const) {
      for (const v of rendered.report[k]) if (!report[k].includes(v)) report[k].push(v);
    }
  }
  return {
    ok: true,
    html: resolvedToHtml(resolved),
    text: resolvedToText(resolved),
    subjectText,
    report,
  };
}
