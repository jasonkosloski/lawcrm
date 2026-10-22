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
import { contentOf, loadBlockMap } from "@/lib/templates/template-source";
import { resolvedToHtml } from "@/lib/templates/to-html";
import { resolvedToText } from "@/lib/templates/to-text";
import {
  getDocumentStyle,
  loadLogo,
  type LoadedDocumentStyle,
} from "@/lib/templates/document-style";
import {
  logoPreviewUrl,
  logoRefOf,
  mergeReport,
  renderPage,
  renderPageView,
  styleBlockIds,
  type GenerationReport,
  type PageKind,
  type PageView,
} from "@/lib/templates/page-render";
import { resolvedToDocx } from "@/lib/templates/to-docx";
import { resolvedToPdf } from "@/lib/templates/to-pdf";
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
const PDF_MIME = "application/pdf";
const FORMATS = ["docx", "pdf", "both"] as const;
export type GenerateFormat = (typeof FORMATS)[number];

/** Kinds that produce a saved document (email and SMS are message drafts). */
const isDocumentKind = (kind: string): kind is PageKind => kind === "letter" || kind === "filing";

/** The body plus the style's block refs, so signer/recipient detection
 *  sees fields used in the letterhead or continuation header too. */
const withStyleBlocks = (doc: TemplateDoc, ids: string[]): TemplateDoc => ({
  type: "doc",
  content: [
    ...(doc.content ?? []),
    ...ids.map((blockId) => ({ type: "block" as const, attrs: { blockId } })),
  ],
});

/** Preview-side page: the style without logo bytes, the logo via its route. */
function previewPage(
  doc: TemplateDoc,
  kind: PageKind,
  data: TemplateData,
  blocks: Map<string, BlockSource>,
  style: LoadedDocumentStyle,
): { page: PageView; report: RenderReport } {
  return renderPageView({
    doc,
    kind,
    data,
    blocks,
    style,
    logo: logoRefOf(style),
    logoUrl: logoPreviewUrl(style.updatedAt.toISOString()),
  });
}

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
      /** Rendered by <PagePreview/> in the browser. */
      page: PageView;
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
  const kind = template.kind;

  const doc = contentOf(template);
  const style = await getDocumentStyle();
  const styleIds = styleBlockIds(kind, style);
  const blocks = await loadBlockMap(doc, styleIds);
  const loaded = await loadTemplateData({
    scope,
    signerId: opts?.signerId,
    recipientContactId: opts?.recipientContactId,
    request,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const { page, report } = previewPage(doc, kind, loaded.data, blocks, style);
  const whole = withStyleBlocks(doc, styleIds);
  return {
    ok: true,
    templateName: template.name,
    html: resolvedToHtml(page.body),
    text: resolvedToText(page.body),
    page,
    report,
    templateUpdatedAt: template.updatedAt.toISOString(),
    needsSigner: usesSigner(whole, blocks),
    needsRecipient: usesRecipient(whole, blocks),
  };
}

export type GenerateDocumentResult =
  | { ok: true; documents: { id: string; name: string }[]; report: GenerationReport }
  | { ok: false; error: string };

/**
 * Render + SAVE: renders once in the firm's document style, converts to
 * the chosen `format` (.docx, PDF, or both), stores each file, then
 * creates every Document row in ONE transaction (source "generated"),
 * mirroring uploadDocument's storage + row + activity shape. Any failure
 * after a store deletes every stored file and returns one error. Gated
 * on `documents.upload`.
 *
 * Missing/invalid fields, an unreadable logo and PDF font gaps do NOT
 * block the save (the caller previews first and placeholders are visible
 * in the output); they come back in `report` (`warnings` holds the logo
 * and PDF notes). A template that changed since the preview
 * (`expectedUpdatedAt`) is refused.
 */
export async function generateDocumentFromTemplate(
  templateId: string,
  scope: RecordScope,
  opts: GenerateOpts & {
    folderId?: string | null;
    expectedUpdatedAt: string;
    format?: GenerateFormat;
  },
): Promise<GenerateDocumentResult> {
  const userId = await requirePermission("documents.upload");
  // Tagging a document to a records request is a records edit.
  if (opts.recordsRequestId) await requirePermission("records.edit");
  const format = opts.format ?? "docx";
  if (!FORMATS.includes(format)) return { ok: false, error: "Choose Word, PDF or both." };
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
  const kind = template.kind;

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

  // One style + logo load per generation; every format renders from it.
  const doc = contentOf(template);
  const style = await getDocumentStyle();
  const blocks = await loadBlockMap(doc, styleBlockIds(kind, style));
  const loaded = await loadTemplateData({
    scope,
    signerId: opts.signerId,
    recipientContactId: opts.recipientContactId,
    request,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error };

  // Filings never show a letterhead, so their logo is never read.
  const { logo, warning } =
    kind === "letter" ? await loadLogo(style) : { logo: null, warning: null };
  const page = renderPage({ doc, kind, data: loaded.data, blocks, style, logo });
  const report: GenerationReport = { ...page.report, warnings: warning ? [warning] : [] };
  const parts = {
    body: page.body,
    letterhead: page.letterhead,
    continuation: page.continuation,
    style: page.style,
  };

  // "<template name> — <date>.docx|.pdf" — the date disambiguates repeat generations.
  const base = `${template.name} — ${formatDate(loaded.data.today, "medium", loaded.data.timeZone)}`;
  const outputs: { name: string; type: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
  try {
    if (format !== "pdf") {
      const docx = await resolvedToDocx(parts);
      outputs.push({ name: `${base}.docx`, type: DOCX_MIME, bytes: new Uint8Array(docx) });
    }
    if (format !== "docx") {
      const pdf = await resolvedToPdf(parts);
      for (const w of pdf.warnings) if (!report.warnings.includes(w)) report.warnings.push(w);
      outputs.push({ name: `${base}.pdf`, type: PDF_MIME, bytes: new Uint8Array(pdf.buffer) });
    }
  } catch (err) {
    return {
      ok: false,
      error: toUserMessage(
        err,
        "Couldn't create the document. Try again.",
        "generateDocumentFromTemplate.convert",
      ),
    };
  }

  // Once anything is stored, every exit that doesn't create the rows
  // deletes it: no row will ever point at an orphan file.
  const stored: Awaited<ReturnType<typeof storeFile>>[] = [];
  const cleanup = () => Promise.all(stored.map((f) => deleteFile(f.key).catch(() => {})));

  // Node's global File — same shape uploadDocument receives from the
  // browser. Infrastructure failures (blob 5xx, misconfigured driver,
  // matter deleted mid-request) come back as {ok:false} so the dialog
  // shows an inline error instead of the route error boundary.
  try {
    for (const o of outputs) {
      stored.push(await storeFile(new File([o.bytes], o.name, { type: o.type })));
    }
  } catch (err) {
    await cleanup();
    return {
      ok: false,
      error: toUserMessage(
        err,
        "Couldn't save the document — storage is unavailable. Try again.",
        "generateDocumentFromTemplate.storeFile",
      ),
    };
  }

  let documents: { id: string; name: string }[];
  try {
    documents = await prisma.$transaction(async (tx) => {
      let target: {
        folderId: string | null;
        recordsRequestId?: string;
        recordsRequestRole?: "request_letter";
      } = { folderId };
      if (request) {
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
        target = {
          folderId: requestFolderId,
          recordsRequestId: request.id,
          recordsRequestRole: "request_letter",
        };
      }
      const rows: { id: string; name: string }[] = [];
      for (const [i, f] of stored.entries()) {
        rows.push(
          await tx.document.create({
            data: {
              ...scopeWhere(scope),
              ...target,
              name: outputs[i]!.name,
              category: documentCategoryForTemplate(template.category),
              source: "generated",
              fileUrl: f.key,
              contentType: f.contentType,
              fileSize: f.size,
              uploadedBy: userId,
            },
            select: { id: true, name: true },
          }),
        );
      }
      return rows;
    });
  } catch (err) {
    await cleanup();
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
    detail: `${documents.map((d) => d.name).join(", ")} (from "${template.name}")`,
  });

  revalidateDocumentScope(scope);
  return { ok: true, documents, report };
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
  | {
      ok: true;
      html: string;
      text: string;
      subjectText: string | null;
      /** Letters and filings only. */
      page: PageView | null;
      report: RenderReport;
    }
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

  const kind = input.kind;
  const style = isDocumentKind(kind) ? await getDocumentStyle() : null;
  const blocks = await loadBlockMap(
    content.doc,
    style && isDocumentKind(kind) ? styleBlockIds(kind, style) : [],
  );

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

  let page: PageView | null = null;
  let resolved;
  let report: RenderReport;
  if (style && isDocumentKind(kind)) {
    ({ page, report } = previewPage(content.doc, kind, data, blocks, style));
    resolved = page.body;
  } else {
    ({ doc: resolved, report } = renderTemplate(content.doc, { data, blocks }));
  }
  let subjectText: string | null = null;
  if (subjectDoc) {
    const rendered = renderTemplate(subjectDoc, { data, blocks });
    subjectText = resolvedToText(rendered.doc);
    mergeReport(report, rendered.report);
  }
  return {
    ok: true,
    html: resolvedToHtml(resolved),
    text: resolvedToText(resolved),
    subjectText,
    page,
    report,
  };
}
