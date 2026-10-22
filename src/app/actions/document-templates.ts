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
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { deleteFile, storeFile } from "@/lib/file-storage";
import { toUserMessage } from "@/lib/user-facing-error";
import { formatDate } from "@/lib/format-date";
import { resolveRecordsRoleFolder } from "@/lib/records-requests/folder";
import { mergeTemplate, type MergeContext } from "@/lib/template-merge";
import {
  composeContactAddress,
  loadRecordsRequest,
  type LoadedRecordsRequest,
} from "@/lib/templates/load-data";
import { Prisma } from "@/generated/prisma/client";
import { checkTemplateFit, collectBlockIds } from "@/lib/templates/inspect";
import {
  APPLIES_TO,
  TEMPLATE_KINDS,
  validateSubject,
  validateTemplateContent,
  type AppliesTo,
  type TemplateKind,
} from "@/lib/templates/schema";
import {
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATE_DESCRIPTION,
  MAX_TEMPLATE_NAME,
  documentCategoryForTemplate,
  isTemplateCategory,
  templateCategoryLabel,
  templateFormInitialState,
  type TemplateFormState,
} from "@/lib/template-constants";

// Legacy: removed with the editor dialog
const templateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(MAX_TEMPLATE_NAME),
  // Category is a free string in the schema; v1 validates against
  // the curated list so the picker + grouping stay coherent. When
  // firm-defined categories land, loosen here only.
  category: z.string().min(1, "Category is required.").max(60),
  description: z.string().trim().max(MAX_TEMPLATE_DESCRIPTION).optional().or(z.literal("")),
  body: z
    .string()
    .min(1, "Template body is required.")
    .max(MAX_TEMPLATE_BODY, "Template body is too long."),
});

// Legacy: removed with the editor dialog
function parseTemplateForm(
  formData: FormData,
  /** An existing row's category stays valid when unchanged even if
   *  it isn't in the curated list (imported / pre-validation rows),
   *  so fixing a typo in the body doesn't force a re-categorize. */
  keepCategory?: string,
): { ok: true; data: z.infer<typeof templateSchema> } | { ok: false; error: string } {
  const parsed = templateSchema.safeParse({
    name: (formData.get("name") as string | null) ?? "",
    category: (formData.get("category") as string | null) ?? "general",
    description: (formData.get("description") as string | null) ?? "",
    body: (formData.get("body") as string | null) ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid template — check the fields.",
    };
  }
  if (!isTemplateCategory(parsed.data.category) && parsed.data.category !== keepCategory) {
    return { ok: false, error: "Unknown category." };
  }
  return { ok: true, data: parsed.data };
}

/** Firm-scope audit entry (no matter) for library changes — a
 *  rewritten or deleted template changes every future letter. */
async function logTemplateChange(
  userId: string,
  title: string,
  detail: string | null,
): Promise<void> {
  await logActivity({
    matterId: null,
    userId,
    type: "document",
    title,
    detail,
    source: "Settings",
  });
}

// ── Library CRUD ───────────────────────────────────────────────────────

// Legacy: removed with the editor dialog
export async function createDocumentTemplate(
  _prev: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const userId = await requirePermission("documents.template.create");
  const parsed = parseTemplateForm(formData);
  if (!parsed.ok) return { status: "error", error: parsed.error };

  const created = await prisma.documentTemplate.create({
    data: {
      name: parsed.data.name,
      category: parsed.data.category,
      description: parsed.data.description?.trim() || null,
      body: parsed.data.body,
      createdById: userId,
    },
    select: { id: true },
  });

  await logTemplateChange(
    userId,
    `Template "${parsed.data.name}" created`,
    `Category: ${templateCategoryLabel(parsed.data.category)} (id ${created.id})`,
  );

  revalidatePath("/settings/templates");
  return { ...templateFormInitialState, status: "ok" };
}

// Legacy: removed with the editor dialog
export async function updateDocumentTemplate(
  templateId: string,
  _prev: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const userId = await requirePermission("documents.template.edit");

  const existing = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
      body: true,
    },
  });
  if (!existing) {
    return { status: "error", error: "Template not found." };
  }

  const parsed = parseTemplateForm(formData, existing.category);
  if (!parsed.ok) return { status: "error", error: parsed.error };

  await prisma.documentTemplate.update({
    where: { id: templateId },
    data: {
      name: parsed.data.name,
      category: parsed.data.category,
      description: parsed.data.description?.trim() || null,
      body: parsed.data.body,
    },
  });

  // Old -> new for the small fields; the body can be 50k chars, so
  // only record THAT it changed (the audit trail answers who/when).
  const newDescription = parsed.data.description?.trim() || null;
  const changes = [
    existing.name !== parsed.data.name ? `name "${existing.name}" -> "${parsed.data.name}"` : null,
    existing.category !== parsed.data.category
      ? `category ${existing.category} -> ${parsed.data.category}`
      : null,
    existing.description !== newDescription ? "description changed" : null,
    existing.body !== parsed.data.body ? "body changed" : null,
  ].filter((c): c is string => c !== null);
  await logTemplateChange(
    userId,
    `Template "${parsed.data.name}" updated`,
    changes.length > 0 ? changes.join("; ") : "No field changes",
  );

  revalidatePath("/settings/templates");
  return { ...templateFormInitialState, status: "ok" };
}

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
  expectedUpdatedAt: z.string().optional(),
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
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
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
      select: { id: true },
    });
    await logTemplateChange(
      userId,
      `Template "${name}" created`,
      `Category: ${templateCategoryLabel(data.category)} (id ${created.id})`,
    );
    revalidatePath("/settings/templates");
    return { ok: true, id: created.id };
  }

  // Atomic stale check: the write only matches the row version the
  // editor loaded, so two concurrent saves cannot both win.
  const { count } = await prisma.documentTemplate.updateMany({
    where: {
      id: input.id,
      ...(parsed.data.expectedUpdatedAt
        ? { updatedAt: new Date(parsed.data.expectedUpdatedAt) }
        : {}),
    },
    data,
  });
  if (count === 0) {
    return { ok: false, error: "Someone else saved this template — reload to see their changes." };
  }
  await logTemplateChange(userId, `Template "${name}" updated`, `id ${input.id}`);
  revalidatePath("/settings/templates");
  return { ok: true, id: input.id };
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

/** Build the real MergeContext for a record scope. Matter: matter +
 *  client contact. Lead: matter fields are all null (name = the lead's
 *  display name); client = the lead's contact, falling back to the
 *  legacy name/email/phone columns. Firm + generating user + today
 *  are shared. Null when the record is gone. */
async function resolveMergeContext(
  scope: RecordScope,
  request: LoadedRecordsRequest | null = null,
): Promise<{
  ctx: MergeContext;
  matterName: string;
} | null> {
  const userId = await getCurrentUserId();
  const contactSelect = {
    name: true,
    email: true,
    phone: true,
    address: true,
    city: true,
    state: true,
    zip: true,
  } as const;
  const [record, firm, user] = await Promise.all([
    scope.kind === "matter"
      ? prisma.matter
          .findUnique({
            where: { id: scope.matterId },
            select: {
              name: true,
              caseNumber: true,
              court: true,
              opposingParty: true,
              incidentDate: true,
              statuteOfLimitationsDate: true,
              practiceArea: { select: { name: true } },
              stage: { select: { name: true } },
              client: { select: contactSelect },
            },
          })
          .then((m) => ({ kind: "matter" as const, m }))
      : prisma.lead
          .findUnique({
            where: { id: scope.leadId },
            select: {
              name: true,
              email: true,
              phone: true,
              contact: { select: contactSelect },
            },
          })
          .then((l) => ({ kind: "lead" as const, l })),
    getCurrentFirm(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, timeZone: true },
    }),
  ]);

  const firmCtx = {
    name: firm.name,
    addressLine1: firm.addressLine1,
    addressLine2: firm.addressLine2,
    city: firm.city,
    state: firm.state,
    zip: firm.zip,
    phone: firm.phone,
    email: firm.email,
  };
  const shared = {
    firm: firmCtx,
    user: { name: user?.name ?? null },
    request: request
      ? {
          subject: request.subject,
          description: request.description,
          type: request.type?.name ?? request.adHocTypeName,
          dateRangeStart: request.dateRangeStart,
          dateRangeEnd: request.dateRangeEnd,
          responseDueDate: request.responseDueDate,
          sentDate: request.sentAt,
        }
      : null,
    custodian: request
      ? {
          name: request.custodian.name,
          organization: request.custodian.organization,
          address: composeContactAddress(request.custodian),
          email: request.custodian.email,
          phone: request.custodian.phone,
        }
      : null,
    today: new Date(),
    timeZone: user?.timeZone ?? null,
  };

  if (record.kind === "lead") {
    const lead = record.l;
    if (!lead) return null;
    const c = lead.contact;
    const displayName = c?.name ?? lead.name;
    return {
      matterName: displayName,
      ctx: {
        matter: {
          name: displayName,
          caseNumber: null,
          practiceArea: null,
          stage: null,
          court: null,
          opposingParty: null,
          incidentDate: null,
          solDate: null,
        },
        client: {
          name: displayName,
          email: c?.email ?? lead.email,
          phone: c?.phone ?? lead.phone,
          address: c ? composeContactAddress(c) : null,
        },
        ...shared,
      },
    };
  }

  const matter = record.m;
  if (!matter) return null;
  return {
    matterName: matter.name,
    ctx: {
      matter: {
        name: matter.name,
        caseNumber: matter.caseNumber,
        practiceArea: matter.practiceArea?.name ?? null,
        stage: matter.stage?.name ?? null,
        court: matter.court,
        opposingParty: matter.opposingParty,
        incidentDate: matter.incidentDate,
        solDate: matter.statuteOfLimitationsDate,
      },
      client: matter.client
        ? {
            name: matter.client.name,
            email: matter.client.email,
            phone: matter.client.phone,
            address: composeContactAddress(matter.client),
          }
        : null,
      ...shared,
    },
  };
}

export type TemplatePreviewResult =
  | {
      ok: true;
      templateName: string;
      text: string;
      unresolved: string[];
      missing: string[];
    }
  | { ok: false; error: string };

/**
 * Merge a template against a real matter WITHOUT writing anything.
 * Requires the same key as `generateDocumentFromTemplate`
 * (`documents.upload`) so a preview never shows more than the user
 * could produce.
 */
export async function previewDocumentFromTemplate(
  templateId: string,
  scope: RecordScope,
  opts?: { recordsRequestId?: string },
): Promise<TemplatePreviewResult> {
  await assertScopeAccess(scope);
  if (!(await currentUserHasPermission("documents.upload"))) {
    return {
      ok: false,
      error: "You don't have permission to generate documents from templates.",
    };
  }
  // The merged text exposes custodian + request details.
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
    select: { name: true, body: true, isActive: true },
  });
  if (!template || !template.isActive) {
    return { ok: false, error: "Template not found or archived." };
  }

  const resolved = await resolveMergeContext(scope, request);
  if (!resolved) return { ok: false, error: "Record not found." };

  const merged = mergeTemplate(template.body ?? "", resolved.ctx);
  return {
    ok: true,
    templateName: template.name,
    text: merged.text,
    unresolved: merged.unresolved,
    missing: merged.missing,
  };
}

export type GenerateDocumentResult =
  | {
      ok: true;
      documentId: string;
      documentName: string;
      unresolved: string[];
      missing: string[];
    }
  | { ok: false; error: string };

/**
 * Merge + SAVE: writes the merged text as a markdown file via the
 * file-storage lib and creates a Document row on the matter (source
 * "generated"), mirroring uploadDocument's storage + row + activity
 * shape. Gated on `documents.upload`.
 *
 * Unresolved/missing fields do NOT block the save — the caller
 * previews first and the placeholders are visible in the output —
 * but they're returned so the UI can warn one last time.
 */
export async function generateDocumentFromTemplate(
  templateId: string,
  scope: RecordScope,
  opts?: { recordsRequestId?: string },
): Promise<GenerateDocumentResult> {
  const userId = await requirePermission("documents.upload");
  // Tagging a document to a records request is a records edit.
  if (opts?.recordsRequestId) await requirePermission("records.edit");
  await assertScopeAccess(scope);
  const readOnly = await assertScopeWritable(scope);
  if (readOnly) return { ok: false, error: readOnly };
  const request = opts?.recordsRequestId
    ? await loadRecordsRequest(scope, opts.recordsRequestId)
    : null;
  if (opts?.recordsRequestId && !request) {
    return { ok: false, error: REQUEST_NOT_FOUND };
  }

  const template = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { name: true, body: true, category: true, isActive: true },
  });
  if (!template || !template.isActive) {
    return { ok: false, error: "Template not found or archived." };
  }

  const resolved = await resolveMergeContext(scope, request);
  if (!resolved) return { ok: false, error: "Record not found." };

  const merged = mergeTemplate(template.body ?? "", resolved.ctx);

  // "<template name> — <date>.md" — matches the naming the docs tab
  // sorts/reads well, and the date disambiguates repeat generations.
  const documentName = `${template.name} — ${formatDate(
    resolved.ctx.today,
    "medium",
    resolved.ctx.timeZone,
  )}.md`;

  // Node's global File — same shape uploadDocument receives from the
  // browser, so storeFile needs no new entry point for text output.
  // Infrastructure failures (blob 5xx, misconfigured driver, matter
  // deleted mid-request) come back as {ok:false} so the dialog shows
  // an inline error instead of the route error boundary.
  let stored: Awaited<ReturnType<typeof storeFile>>;
  try {
    stored = await storeFile(new File([merged.text], documentName, { type: "text/markdown" }));
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

  let doc: { id: string };
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
    doc = request
      ? await prisma.$transaction(async (tx) => {
          const folderId = await resolveRecordsRoleFolder(
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
              folderId,
              recordsRequestId: request.id,
              recordsRequestRole: "request_letter",
            },
            select: { id: true },
          });
        })
      : await prisma.document.create({ data, select: { id: true } });
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
  return {
    ok: true,
    documentId: doc.id,
    documentName,
    unresolved: merged.unresolved,
    missing: merged.missing,
  };
}
