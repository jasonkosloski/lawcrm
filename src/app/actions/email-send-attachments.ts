/**
 * Reads behind the composer's "Attach" picker. Attachments are
 * documents filed to the email's matter or lead (see
 * src/lib/email-send-attachments.ts), so both reads are gated like a
 * send and scoped to that record.
 */

"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { assertScopeAccess } from "@/lib/scope-access";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";

export type AttachableDocument = {
  id: string;
  name: string;
  fileSize: number | null;
};

const PICKER_LIMIT = 50;

/** The record's documents that can be attached, newest first,
 *  optionally filtered by name. */
export async function listAttachableDocuments(
  scope: RecordScope,
  query = "",
): Promise<AttachableDocument[]> {
  await requirePermission("communication.send_email");
  await assertScopeAccess(scope);
  const q = query.trim().slice(0, 200);
  return prisma.document.findMany({
    where: {
      ...scopeWhere(scope),
      fileUrl: { not: null },
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: PICKER_LIMIT,
    select: { id: true, name: true, fileSize: true },
  });
}

/** The Document a client-direct blob upload created, once Vercel's
 *  completion callback has written it (null until then). */
export async function findUploadedDocument(
  scope: RecordScope,
  fileUrl: string,
): Promise<AttachableDocument | null> {
  await requirePermission("communication.send_email");
  await assertScopeAccess(scope);
  return prisma.document.findFirst({
    where: { ...scopeWhere(scope), fileUrl },
    select: { id: true, name: true, fileSize: true },
  });
}
