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
 *   - PREVIEW a merge: ungated (session only). A preview reads data
 *     the user can already see on the matter page and writes
 *     nothing, so gating it would only break the "check the letter
 *     before you ask someone with upload rights to save it" flow.
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
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { storeFile } from "@/lib/file-storage";
import { formatDate } from "@/lib/format-date";
import {
  composeCityStateZip,
  mergeTemplate,
  type MergeContext,
} from "@/lib/template-merge";
import {
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATE_DESCRIPTION,
  MAX_TEMPLATE_NAME,
  documentCategoryForTemplate,
  isTemplateCategory,
  templateFormInitialState,
  type TemplateFormState,
} from "@/lib/template-constants";

const templateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(MAX_TEMPLATE_NAME),
  // Category is a free string in the schema; v1 validates against
  // the curated list so the picker + grouping stay coherent. When
  // firm-defined categories land, loosen here only.
  category: z.string().refine(isTemplateCategory, "Unknown category."),
  description: z
    .string()
    .trim()
    .max(MAX_TEMPLATE_DESCRIPTION)
    .optional()
    .or(z.literal("")),
  body: z
    .string()
    .min(1, "Template body is required.")
    .max(MAX_TEMPLATE_BODY, "Template body is too long."),
});

function parseTemplateForm(formData: FormData):
  | { ok: true; data: z.infer<typeof templateSchema> }
  | { ok: false; error: string } {
  const parsed = templateSchema.safeParse({
    name: (formData.get("name") as string | null) ?? "",
    category: (formData.get("category") as string | null) ?? "general",
    description: (formData.get("description") as string | null) ?? "",
    body: (formData.get("body") as string | null) ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Invalid template — check the fields.",
    };
  }
  return { ok: true, data: parsed.data };
}

// ── Library CRUD ───────────────────────────────────────────────────────

export async function createDocumentTemplate(
  _prev: TemplateFormState,
  formData: FormData
): Promise<TemplateFormState> {
  const userId = await requirePermission("documents.template.create");
  const parsed = parseTemplateForm(formData);
  if (!parsed.ok) return { status: "error", error: parsed.error };

  await prisma.documentTemplate.create({
    data: {
      name: parsed.data.name,
      category: parsed.data.category,
      description: parsed.data.description?.trim() || null,
      body: parsed.data.body,
      createdById: userId,
    },
  });

  revalidatePath("/settings/templates");
  return { ...templateFormInitialState, status: "ok" };
}

export async function updateDocumentTemplate(
  templateId: string,
  _prev: TemplateFormState,
  formData: FormData
): Promise<TemplateFormState> {
  await requirePermission("documents.template.edit");
  const parsed = parseTemplateForm(formData);
  if (!parsed.ok) return { status: "error", error: parsed.error };

  const existing = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  if (!existing) {
    return { status: "error", error: "Template not found." };
  }

  await prisma.documentTemplate.update({
    where: { id: templateId },
    data: {
      name: parsed.data.name,
      category: parsed.data.category,
      description: parsed.data.description?.trim() || null,
      body: parsed.data.body,
    },
  });

  revalidatePath("/settings/templates");
  return { ...templateFormInitialState, status: "ok" };
}

/** Archive (isActive=false) or restore (true). Soft state only —
 *  generation pickers hide archived templates, history is intact.
 *  Gated as an EDIT: same firm-wide blast radius, no data loss. */
export async function setDocumentTemplateActive(
  templateId: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("documents.template.edit");
  const existing = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Template not found." };

  await prisma.documentTemplate.update({
    where: { id: templateId },
    data: { isActive },
  });
  revalidatePath("/settings/templates");
  return { ok: true };
}

/** HARD delete — the row is gone. Already-generated documents are
 *  untouched (they're plain Document rows with their own file).
 *  Prefer archive unless the template was a mistake. */
export async function deleteDocumentTemplate(
  templateId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("documents.template.delete");
  const existing = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Template not found." };

  await prisma.documentTemplate.delete({ where: { id: templateId } });
  revalidatePath("/settings/templates");
  return { ok: true };
}

// ── Generation ─────────────────────────────────────────────────────────

/** Build the real MergeContext for a matter: matter + client contact
 *  + current firm + generating user. Null when the matter is gone. */
async function resolveMergeContext(matterId: string): Promise<{
  ctx: MergeContext;
  matterName: string;
} | null> {
  const userId = await getCurrentUserId();
  const [matter, firm, user] = await Promise.all([
    prisma.matter.findUnique({
      where: { id: matterId },
      select: {
        name: true,
        caseNumber: true,
        court: true,
        opposingParty: true,
        incidentDate: true,
        statuteOfLimitationsDate: true,
        practiceArea: { select: { name: true } },
        stage: { select: { name: true } },
        client: {
          select: {
            name: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            zip: true,
          },
        },
      },
    }),
    getCurrentFirm(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, timeZone: true },
    }),
  ]);
  if (!matter) return null;

  const client = matter.client
    ? {
        name: matter.client.name,
        email: matter.client.email,
        phone: matter.client.phone,
        address:
          [
            matter.client.address,
            composeCityStateZip(
              matter.client.city,
              matter.client.state,
              matter.client.zip
            ),
          ]
            .filter(Boolean)
            .join(", ") || null,
      }
    : null;

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
      client,
      firm: {
        name: firm.name,
        addressLine1: firm.addressLine1,
        addressLine2: firm.addressLine2,
        city: firm.city,
        state: firm.state,
        zip: firm.zip,
        phone: firm.phone,
        email: firm.email,
      },
      user: { name: user?.name ?? null },
      today: new Date(),
      timeZone: user?.timeZone ?? null,
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
 * Deliberately ungated beyond sign-in (see file header): previews
 * read what the matter page already shows and persist nothing —
 * only `generateDocumentFromTemplate` (which writes a file + row)
 * requires `documents.upload`.
 */
export async function previewDocumentFromTemplate(
  templateId: string,
  matterId: string
): Promise<TemplatePreviewResult> {
  const template = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { name: true, body: true, isActive: true },
  });
  if (!template || !template.isActive) {
    return { ok: false, error: "Template not found or archived." };
  }

  const resolved = await resolveMergeContext(matterId);
  if (!resolved) return { ok: false, error: "Matter not found." };

  const merged = mergeTemplate(template.body, resolved.ctx);
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
  matterId: string
): Promise<GenerateDocumentResult> {
  const userId = await requirePermission("documents.upload");

  const template = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    select: { name: true, body: true, category: true, isActive: true },
  });
  if (!template || !template.isActive) {
    return { ok: false, error: "Template not found or archived." };
  }

  const resolved = await resolveMergeContext(matterId);
  if (!resolved) return { ok: false, error: "Matter not found." };

  const merged = mergeTemplate(template.body, resolved.ctx);

  // "<template name> — <date>.md" — matches the naming the docs tab
  // sorts/reads well, and the date disambiguates repeat generations.
  const documentName = `${template.name} — ${formatDate(
    resolved.ctx.today,
    "medium",
    resolved.ctx.timeZone
  )}.md`;

  // Node's global File — same shape uploadDocument receives from the
  // browser, so storeFile needs no new entry point for text output.
  const stored = await storeFile(
    new File([merged.text], documentName, { type: "text/markdown" })
  );

  const doc = await prisma.document.create({
    data: {
      matterId,
      name: documentName,
      category: documentCategoryForTemplate(template.category),
      source: "generated",
      fileUrl: stored.key,
      contentType: stored.contentType,
      fileSize: stored.size,
      uploadedBy: userId,
    },
    select: { id: true },
  });

  await logActivity({
    matterId,
    userId,
    type: "document",
    title: "Document generated from template",
    detail: `${documentName} (from "${template.name}")`,
  });

  revalidatePath(`/matters/${matterId}/documents`);
  revalidatePath(`/matters/${matterId}`);
  return {
    ok: true,
    documentId: doc.id,
    documentName,
    unresolved: merged.unresolved,
    missing: merged.missing,
  };
}
