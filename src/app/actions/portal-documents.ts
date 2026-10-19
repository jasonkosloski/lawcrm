/**
 * Staff actions for portal document requests.
 *
 * Every action gates on its permission, then asserts matter access
 * (ADR-039) outside any try/catch so a walled user gets Next's
 * not-found. Status transitions are compare-and-swap `updateMany`s so
 * two racing actions can never both win.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { assertMatterAccess } from "@/lib/matter-access";
import { assertScopeAccess } from "@/lib/scope-access";
import { currentUserHasPermission, requirePermissionResult } from "@/lib/permission-check";
import { logActivity, logActivityTx } from "@/lib/activity-log";
import { parseDateOnly } from "@/lib/format-date";
import { documentRequestEmail, documentsSharedEmail } from "@/lib/portal/emails";
import { portalHomeUrl } from "@/lib/portal/link-url";
import { MOVE_DOCUMENTS_BATCH_CAP, collectDescendantIds } from "@/lib/folder-tree";
import { isEffectivelyShared, sharedFolderIds } from "@/lib/portal/document-visibility";
import { emailLivePortalUsers } from "@/lib/portal/notify-clients";
import { isProtectedFolder } from "@/lib/records-requests/folder-kinds";

type Result = { ok: true } | { ok: false; error: string };
type Input = { title: string; instructions?: string; dueDate?: string };

const CONFLICT = "This request changed, refresh to see it.";
const NOT_FOUND = "Request not found.";
const HAS_FILES = "This request has files attached. Cancel it instead.";
const MAX_TITLE = 200;
const MAX_TEXT = 5000;

function parseInput(
  input: Input
):
  | { ok: true; title: string; instructions: string | null; dueDate: Date | null }
  | { ok: false; error: string } {
  const title = (input?.title ?? "").trim();
  if (!title) return { ok: false, error: "Enter a title." };
  if (title.length > MAX_TITLE) return { ok: false, error: "That title is too long." };
  const instructions = (input?.instructions ?? "").trim();
  if (instructions.length > MAX_TEXT) {
    return { ok: false, error: "Those instructions are too long." };
  }
  let dueDate: Date | null = null;
  if (input?.dueDate) {
    dueDate = parseDateOnly(input.dueDate);
    if (!dueDate) return { ok: false, error: "Enter a valid due date." };
  }
  return { ok: true, title, instructions: instructions || null, dueDate };
}

function done(matterId: string): Result {
  revalidatePath(`/matters/${matterId}`);
  return { ok: true };
}

export async function createDocumentRequest(
  matterId: string,
  input: Input
): Promise<Result> {
  const gate = await requirePermissionResult("portal.add_requests");
  if (!gate.ok) return { ok: false, error: gate.error };
  await assertMatterAccess(matterId);

  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;

  await prisma.documentRequest.create({
    data: {
      matterId,
      title: parsed.title,
      instructions: parsed.instructions,
      dueDate: parsed.dueDate,
      createdById: gate.userId,
    },
  });

  let emailFailed = false;
  try {
    const res = await emailLivePortalUsers(
      matterId,
      documentRequestEmail(portalHomeUrl())
    );
    emailFailed = res.failed > 0;
  } catch (err) {
    console.warn("[portal-documents] request email failed", err);
    emailFailed = true;
  }
  await logActivity({
    matterId,
    userId: gate.userId,
    type: "document",
    title: `Requested documents from the client: ${parsed.title}`,
    detail: emailFailed ? "— email failed" : null,
  });
  return done(matterId);
}

async function loadRequest(id: string) {
  return prisma.documentRequest.findUnique({
    where: { id },
    select: { id: true, matterId: true, title: true, status: true },
  });
}

export async function updateDocumentRequest(
  id: string,
  input: Input
): Promise<Result> {
  const gate = await requirePermissionResult("portal.edit_requests");
  if (!gate.ok) return { ok: false, error: gate.error };
  const req = await loadRequest(id);
  if (!req) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(req.matterId);

  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;

  const ok = await prisma.$transaction(async (tx) => {
    const { count } = await tx.documentRequest.updateMany({
      where: { id, status: "open" },
      data: {
        title: parsed.title,
        instructions: parsed.instructions,
        dueDate: parsed.dueDate,
      },
    });
    if (count === 0) return false;
    await logActivityTx(tx, {
      matterId: req.matterId,
      userId: gate.userId,
      type: "document",
      title: `Edited document request: ${parsed.title}`,
    });
    return true;
  });
  if (!ok) return { ok: false, error: CONFLICT };
  return done(req.matterId);
}

async function transition(
  id: string,
  from: string[],
  data: Record<string, unknown>,
  title: (t: string) => string,
  detail?: string
): Promise<Result> {
  const gate = await requirePermissionResult("portal.edit_requests");
  if (!gate.ok) return { ok: false, error: gate.error };
  const req = await loadRequest(id);
  if (!req) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(req.matterId);

  const ok = await prisma.$transaction(async (tx) => {
    const { count } = await tx.documentRequest.updateMany({
      where: { id, status: { in: from } },
      data,
    });
    if (count === 0) return false;
    await logActivityTx(tx, {
      matterId: req.matterId,
      userId: gate.userId,
      type: "document",
      title: title(req.title),
      detail: detail ?? null,
    });
    return true;
  });
  if (!ok) return { ok: false, error: CONFLICT };
  return done(req.matterId);
}

export async function acceptDocumentRequest(id: string): Promise<Result> {
  return transition(
    id,
    ["submitted"],
    { status: "complete", completedAt: new Date() },
    (t) => `Accepted client documents: ${t}`
  );
}

export async function sendBackDocumentRequest(
  id: string,
  note: string
): Promise<Result> {
  const trimmed = (note ?? "").trim();
  if (!trimmed) return { ok: false, error: "Enter a note for the client." };
  if (trimmed.length > MAX_TEXT) return { ok: false, error: "That note is too long." };
  return transition(
    id,
    ["submitted"],
    { status: "open", returnNote: trimmed },
    (t) => `Sent back document request: ${t}`
  );
}

export async function cancelDocumentRequest(id: string): Promise<Result> {
  return transition(
    id,
    ["open", "submitted"],
    { status: "cancelled" },
    (t) => `Cancelled document request: ${t}`
  );
}

export async function deleteDocumentRequest(id: string): Promise<Result> {
  const gate = await requirePermissionResult("portal.delete_requests");
  if (!gate.ok) return { ok: false, error: gate.error };
  const req = await loadRequest(id);
  if (!req) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(req.matterId);

  const res = await prisma.$transaction(async (tx) => {
    // Lock the row so a concurrent upload can't slip between the
    // check and the delete.
    await tx.$queryRaw`SELECT id FROM document_requests WHERE id = ${id} FOR UPDATE`;
    const linked = await tx.document.count({ where: { documentRequestId: id } });
    if (linked > 0) return HAS_FILES;
    const { count } = await tx.documentRequest.deleteMany({ where: { id } });
    if (count === 0) return CONFLICT;
    await logActivityTx(tx, {
      matterId: req.matterId,
      userId: gate.userId,
      type: "document",
      title: `Deleted document request: ${req.title}`,
    });
    return null;
  });
  if (res) return { ok: false, error: res };
  return done(req.matterId);
}

const LEAD_REFUSED = "Lead documents can't be shared with clients.";

/** ADR-039: assert access to a record's scope BEFORE any error that
 *  depends on the record, so a walled id and a missing one both 404.
 *  Lead scopes are not walled (intake is not matter-ACL'd). Never wrap
 *  in try/catch. */
async function assertRecordScope(r: { matterId: string | null; leadId: string | null }) {
  if (r.matterId) await assertMatterAccess(r.matterId);
  else if (r.leadId) await assertScopeAccess({ kind: "lead", leadId: r.leadId });
  else notFound();
}

/** Emails live portal users; true when delivery failed. Never throws. */
async function notifyShared(matterId: string): Promise<boolean> {
  try {
    const res = await emailLivePortalUsers(
      matterId,
      documentsSharedEmail(portalHomeUrl())
    );
    return res.failed > 0;
  } catch (err) {
    console.warn("[portal-documents] shared email failed", err);
    return true;
  }
}

export async function setDocumentsClientShare(
  documentIds: string[],
  shared: boolean
): Promise<Result> {
  const gate = await requirePermissionResult("portal.share_documents");
  if (!gate.ok) return { ok: false, error: gate.error };
  const ids = [...new Set(documentIds ?? [])];
  if (ids.length === 0) return { ok: false, error: "Select at least one file." };
  if (ids.length > MOVE_DOCUMENTS_BATCH_CAP) {
    return {
      ok: false,
      error: `Select no more than ${MOVE_DOCUMENTS_BATCH_CAP} files at a time.`,
    };
  }

  const docs = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      matterId: true,
      leadId: true,
      folderId: true,
      clientShare: true,
      status: true,
    },
  });
  if (docs.length !== ids.length) notFound();
  const scopes = new Map(docs.map((d) => [`${d.matterId}|${d.leadId}`, d]));
  for (const d of scopes.values()) await assertRecordScope(d);
  if (docs.some((d) => d.leadId !== null || d.matterId === null)) {
    return { ok: false, error: LEAD_REFUSED };
  }
  const matterIds = new Set(docs.map((d) => d.matterId));
  if (matterIds.size !== 1) {
    return { ok: false, error: "Select files from one matter at a time." };
  }
  const matterId = docs[0].matterId as string;

  const folders = await prisma.documentFolder.findMany({
    where: { matterId },
    select: { id: true, parentId: true, clientShared: true },
  });
  const sharedFolders = sharedFolderIds(folders);
  // Archived files never reach the portal, so sharing them emails no one.
  const becameVisible =
    shared &&
    docs.some((d) => d.status !== "archived" && !isEffectivelyShared(d, sharedFolders));

  await prisma.$transaction(async (tx) => {
    if (shared) {
      await tx.document.updateMany({ where: { id: { in: ids } }, data: { clientShare: "shared" } });
    } else {
      const hide = docs.filter((d) => d.folderId && sharedFolders.has(d.folderId)).map((d) => d.id);
      const clear = docs.filter((d) => !(d.folderId && sharedFolders.has(d.folderId))).map((d) => d.id);
      if (hide.length) {
        await tx.document.updateMany({ where: { id: { in: hide } }, data: { clientShare: "hidden" } });
      }
      if (clear.length) {
        await tx.document.updateMany({ where: { id: { in: clear } }, data: { clientShare: null } });
      }
    }
  });

  const emailFailed = becameVisible ? await notifyShared(matterId) : false;
  const n = ids.length;
  await logActivity({
    matterId,
    userId: gate.userId,
    type: "document",
    title: `${shared ? "Shared" : "Unshared"} ${n} ${n === 1 ? "file" : "files"} ${shared ? "with" : "from"} the client`,
    detail: emailFailed ? "— email failed" : null,
  });
  return done(matterId);
}

export async function setFolderClientShared(
  folderId: string,
  shared: boolean
): Promise<Result> {
  const gate = await requirePermissionResult("portal.share_documents");
  if (!gate.ok) return { ok: false, error: gate.error };
  const folder = await prisma.documentFolder.findUnique({
    where: { id: folderId },
    select: { id: true, name: true, matterId: true, leadId: true, systemKind: true },
  });
  if (!folder) notFound();
  await assertRecordScope(folder);
  if (folder.leadId !== null || folder.matterId === null) {
    return { ok: false, error: LEAD_REFUSED };
  }
  // System folders ("From client", records requests) are never shared
  // whole; unsharing stays allowed so a stray flag can be cleared.
  if (shared && isProtectedFolder(folder)) {
    return {
      ok: false,
      error: "This folder is managed by the app and can't be shared. Share its files instead.",
    };
  }
  const matterId = folder.matterId;

  const [folders, docs] = await Promise.all([
    prisma.documentFolder.findMany({
      where: { matterId },
      select: { id: true, parentId: true, clientShared: true },
    }),
    prisma.document.findMany({
      where: { matterId, folderId: { not: null }, status: { not: "archived" } },
      select: { clientShare: true, folderId: true },
    }),
  ]);
  const before = sharedFolderIds(folders);
  const after = sharedFolderIds(
    folders.map((f) => (f.id === folderId ? { ...f, clientShared: shared } : f))
  );
  const becameVisible =
    shared &&
    docs.some((d) => !isEffectivelyShared(d, before) && isEffectivelyShared(d, after));

  await prisma.documentFolder.update({
    where: { id: folderId },
    data: { clientShared: shared },
  });

  const emailFailed = becameVisible ? await notifyShared(matterId) : false;
  await logActivity({
    matterId,
    userId: gate.userId,
    type: "document",
    title: `${shared ? "Shared" : "Unshared"} folder ${shared ? "with" : "from"} the client: ${folder.name}`,
    detail: emailFailed ? "— email failed" : null,
  });
  return done(matterId);
}

/**
 * Read-only: how many files would become / stop being visible to the
 * client if this folder moved under `targetFolderId`. Powers the folder
 * move dialog's warning. A missing or walled folder 404s (ADR-039);
 * zeros for users without portal.share_documents, for lead folders,
 * and for bad targets.
 */
export async function previewFolderMoveVisibility(
  folderId: string,
  targetFolderId: string | null
): Promise<{ becomesVisible: number; becomesHidden: number }> {
  const none = { becomesVisible: 0, becomesHidden: 0 };
  const folder = await prisma.documentFolder.findUnique({
    where: { id: folderId },
    select: { matterId: true, leadId: true },
  });
  if (!folder) notFound();
  await assertRecordScope(folder);
  if (folder.leadId !== null || folder.matterId === null) return none;
  const matterId = folder.matterId;
  if (!(await currentUserHasPermission("portal.share_documents"))) return none;

  const folders = await prisma.documentFolder.findMany({
    where: { matterId },
    select: { id: true, parentId: true, clientShared: true },
  });
  const subtree = collectDescendantIds(folders, folderId);
  if (targetFolderId !== null) {
    if (targetFolderId === folderId || subtree.has(targetFolderId)) return none;
    if (!folders.some((f) => f.id === targetFolderId)) return none;
  }
  subtree.add(folderId);
  const docs = await prisma.document.findMany({
    where: { matterId, folderId: { in: [...subtree] }, status: { not: "archived" } },
    select: { clientShare: true, folderId: true },
  });
  const before = sharedFolderIds(folders);
  const after = sharedFolderIds(
    folders.map((f) => (f.id === folderId ? { ...f, parentId: targetFolderId } : f))
  );
  let becomesVisible = 0;
  let becomesHidden = 0;
  for (const d of docs) {
    const was = isEffectivelyShared(d, before);
    const will = isEffectivelyShared(d, after);
    if (!was && will) becomesVisible++;
    else if (was && !will) becomesHidden++;
  }
  return { becomesVisible, becomesHidden };
}
