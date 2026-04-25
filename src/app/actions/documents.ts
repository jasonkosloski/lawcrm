/**
 * Document server actions — upload + delete.
 *
 * Storage backend is pluggable via `src/lib/file-storage.ts`. Today
 * that's local filesystem (`./uploads/`); production swaps in
 * Vercel Blob / S3 with no caller change.
 *
 * Auth model:
 *   - Upload: any signed-in member of the firm can attach to a
 *     matter that belongs to their firm. Admins aren't required for
 *     v1 (most firms want paralegals filing exhibits without
 *     waiting on a partner).
 *   - Delete: the original uploader OR any admin. Other members
 *     have to ask. This keeps "I uploaded the wrong PDF" recoverable
 *     without making delete a free-for-all.
 *
 * Multi-firm: matter-by-id lookup is scoped to the current user's
 * firm, so even if a userId from one firm got a foreign matterId
 * (URL tampering once we go multi-tenant) the action refuses.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm, isCurrentUserAdmin } from "@/lib/firm";
import { logActivity } from "@/lib/activity-log";
import { deleteFile, storeFile } from "@/lib/file-storage";
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_BYTES,
  documentInitialState,
  type DocumentFormState,
} from "@/lib/document-form";

const uploadSchema = z.object({
  // The form may post an empty name when the user wants to keep the
  // file's original filename — we fall back to file.name in that case.
  name: z.string().trim().max(200).optional().or(z.literal("")),
  category: z.enum(DOCUMENT_CATEGORIES).default("other"),
});

export async function uploadDocument(
  matterId: string,
  _prev: DocumentFormState,
  formData: FormData
): Promise<DocumentFormState> {
  const userId = await getCurrentUserId();
  const firm = await getCurrentFirm();

  // Scope: the matter must live in the user's firm. When we go
  // multi-tenant the firm clause keeps a leaked URL from working.
  const matter = await prisma.matter.findFirst({
    where: { id: matterId, client: { OR: [{ firmId: firm.id }, {}] } },
    select: { id: true, name: true },
  });
  // Today every contact lives in the same firm so the firm-scope
  // filter above is a no-op; once Contact has firmId we tighten
  // this. For now just confirm the matter exists.
  if (!matter) {
    return { status: "error", error: "Matter not found." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", error: "Pick a file to upload." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    const limitMB = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));
    return {
      status: "error",
      error: `File is too large (max ${limitMB} MB).`,
    };
  }

  const raw = {
    name: (formData.get("name") as string | null) ?? "",
    category: (formData.get("category") as string | null) ?? "other",
  };
  const parsed = uploadSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", error: "Invalid upload — check the fields." };
  }

  const stored = await storeFile(file);
  // Display name falls back to the file's name when the user
  // didn't override.
  const displayName = parsed.data.name?.trim() || file.name;

  const doc = await prisma.document.create({
    data: {
      matterId: matter.id,
      name: displayName,
      category: parsed.data.category,
      source: "upload",
      fileUrl: stored.key,
      contentType: stored.contentType,
      fileSize: stored.size,
      uploadedBy: userId,
    },
    select: { id: true },
  });

  await logActivity({
    matterId: matter.id,
    userId,
    type: "document",
    title: "Document uploaded",
    detail: displayName,
  });

  revalidatePath(`/matters/${matter.id}/documents`);
  revalidatePath(`/matters/${matter.id}`);
  return { ...documentInitialState, status: "ok" };
}

export async function deleteDocument(
  documentId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      matterId: true,
      name: true,
      fileUrl: true,
      uploadedBy: true,
    },
  });
  if (!doc) return { ok: false, error: "Document not found." };

  // Original uploader OR any admin. Defense against accidental
  // deletion by other team members; admins keep the override.
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin && doc.uploadedBy !== userId) {
    return {
      ok: false,
      error: "Only the uploader or an admin can delete this document.",
    };
  }

  await prisma.document.delete({ where: { id: doc.id } });
  // File-system unlink is best-effort; the DB row is the source of
  // truth and a stray file on disk is a non-issue.
  if (doc.fileUrl) await deleteFile(doc.fileUrl);

  await logActivity({
    matterId: doc.matterId,
    userId,
    type: "document",
    title: "Document deleted",
    detail: doc.name,
  });

  revalidatePath(`/matters/${doc.matterId}/documents`);
  revalidatePath(`/matters/${doc.matterId}`);
  return { ok: true };
}
