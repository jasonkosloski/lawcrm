import "server-only";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/file-storage";
import { createNotifications } from "@/lib/notifications";
import { logPortalEvent } from "@/lib/portal/audit";
import {
  PORTAL_DAILY_UPLOAD_CAP,
  checkPortalUpload,
} from "@/lib/portal/upload-policy";

/**
 * Turn a stored client file into a matter document. Shared by the blob
 * completion webhook and the dev multipart route.
 *
 * The caller has already stored the bytes. This re-checks everything the
 * token step checked, because access can be revoked (or the portal turned
 * off) while a file uploads, and the blob webhook carries no session: the
 * identity comes from the signed token payload. When the upload is refused
 * the stored file is deleted.
 *
 * All writes for one matter run under a transaction-scoped advisory lock,
 * which serializes concurrent uploads to that matter. That makes three
 * otherwise racy steps safe without a unique constraint: creating the one
 * "From client" folder, deciding which file is the first of its batch (one
 * staff notification per batch), and linking later files of a batch to the
 * request the batch's first file submitted. If a duplicate folder ever
 * exists anyway, the oldest is used.
 */

export type RecordPortalUploadInput = {
  identityId: string;
  matterId: string;
  requestId: string | null;
  /** Client-generated uuid shared by the files picked together. */
  batchId: string;
  /** Blob URL (vercel-blob driver) or local key. */
  storageKey: string;
  filename: string;
  /** Server-derived from the filename (checkPortalUpload). */
  contentType: string;
  size: number;
  /** The client's optional "What is this?" note. */
  note?: string | null;
};

export type RecordPortalUploadResult =
  | { ok: true; documentId: string; requestClosed: boolean }
  | { ok: false; error: string };

export const PORTAL_UPLOADS_FOLDER_NAME = "From client";
export const PORTAL_UPLOAD_NOTE_MAX = 500;
const NO_ACCESS = "You no longer have access to this matter.";
const DAY_MS = 24 * 60 * 60 * 1000;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Portal uploads by this identity in the last rolling 24 hours. */
export async function portalUploadsInLastDay(identityId: string): Promise<number> {
  return prisma.document.count({
    where: {
      portalUploaderId: identityId,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
    },
  });
}

export const DAILY_LIMIT_ERROR =
  "You've reached today's upload limit. Please try again tomorrow.";
export const REQUEST_CLOSED_ERROR = "This request was closed by the firm.";

/**
 * Upload-time checks, run before any bytes are accepted (blob token step,
 * dev multipart route). The caller has already resolved the portal identity
 * from the session. `adding` is how many files this call would add.
 */
export async function checkPortalUploadTarget(input: {
  identityId: string;
  matterId: string;
  requestId: string | null;
  batchId: string;
  adding?: number;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const access = await prisma.portalMatterAccess.findFirst({
    where: { identityId: input.identityId, matterId: input.matterId, revokedAt: null },
    select: { id: true },
  });
  if (!access) return { ok: false, status: 404, error: "Matter not found." };

  if (input.requestId) {
    const request = await prisma.documentRequest.findFirst({
      where: { id: input.requestId, matterId: input.matterId },
      select: { status: true },
    });
    if (!request) return { ok: false, status: 404, error: "Request not found." };
    // A batch's later files may follow the first one, which already moved
    // the request to submitted.
    const sameBatch =
      request.status === "submitted" &&
      (await prisma.document.count({
        where: {
          documentRequestId: input.requestId,
          portalBatchId: input.batchId,
          portalUploaderId: input.identityId,
        },
      })) > 0;
    if (request.status !== "open" && !sameBatch) {
      return { ok: false, status: 409, error: REQUEST_CLOSED_ERROR };
    }
  }

  const used = await portalUploadsInLastDay(input.identityId);
  if (used + (input.adding ?? 1) > PORTAL_DAILY_UPLOAD_CAP) {
    return { ok: false, status: 429, error: DAILY_LIMIT_ERROR };
  }
  return { ok: true };
}

async function discard(storageKey: string, why: string): Promise<void> {
  try {
    await deleteFile(storageKey);
  } catch (err) {
    console.error("[portal-upload] could not delete refused file", { why, err });
  }
}

async function lockMatter(tx: Tx, matterId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal_uploads:${matterId}`}))`;
}

async function portalUploadsFolder(tx: Tx, matterId: string): Promise<string> {
  const find = () =>
    tx.documentFolder.findFirst({
      where: { matterId, systemKind: "portal_uploads" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
  const existing = await find();
  if (existing) return existing.id;
  await tx.documentFolder.create({
    data: {
      matterId,
      parentId: null,
      name: PORTAL_UPLOADS_FOLDER_NAME,
      systemKind: "portal_uploads",
      clientShared: false,
    },
  });
  // Re-read so a racing creator (only possible without the lock) still
  // converges on the oldest folder.
  return (await find())!.id;
}

/** open -> submitted for this matter's request, or keep a request this
 *  same batch already submitted. True when the file should link to it. */
async function claimRequest(
  tx: Tx,
  input: RecordPortalUploadInput
): Promise<boolean> {
  if (!input.requestId) return false;
  const moved = await tx.documentRequest.updateMany({
    where: {
      id: input.requestId,
      matterId: input.matterId,
      OR: [
        { status: "open" },
        {
          status: "submitted",
          documents: {
            some: {
              portalBatchId: input.batchId,
              portalUploaderId: input.identityId,
            },
          },
        },
      ],
    },
    data: { status: "submitted", returnNote: null },
  });
  return moved.count === 1;
}

type Outcome =
  | { kind: "existing"; documentId: string }
  | { kind: "refused"; error: string }
  | {
      kind: "created";
      documentId: string;
      requestClosed: boolean;
      firstOfBatch: boolean;
    };

export async function recordPortalUpload(
  input: RecordPortalUploadInput
): Promise<RecordPortalUploadResult> {
  const note = input.note?.trim().slice(0, PORTAL_UPLOAD_NOTE_MAX) || null;

  // Redelivery fast path: never refuse (and so never delete) a file that
  // already has its row, even if access was revoked since.
  const prior = await prisma.document.findFirst({
    where: { fileUrl: input.storageKey },
    select: { id: true },
  });
  if (prior) return { ok: true, documentId: prior.id, requestClosed: false };

  const policy = checkPortalUpload(input.filename);
  if (!policy.ok) {
    await discard(input.storageKey, "type not allowed");
    return { ok: false, error: policy.error };
  }

  const outcome: Outcome = await prisma.$transaction(async (tx) => {
    await lockMatter(tx, input.matterId);

    const again = await tx.document.findFirst({
      where: { fileUrl: input.storageKey },
      select: { id: true },
    });
    if (again) return { kind: "existing", documentId: again.id };

    const [firm, identity, access] = await Promise.all([
      tx.firm.findFirst({ select: { portalEnabled: true } }),
      tx.portalIdentity.findUnique({
        where: { id: input.identityId },
        select: { disabledAt: true },
      }),
      tx.portalMatterAccess.findFirst({
        where: {
          identityId: input.identityId,
          matterId: input.matterId,
          revokedAt: null,
        },
        select: { id: true },
      }),
    ]);
    if (!firm?.portalEnabled || !identity || identity.disabledAt || !access) {
      return { kind: "refused", error: NO_ACCESS };
    }

    const folderId = await portalUploadsFolder(tx, input.matterId);
    const linked = await claimRequest(tx, input);
    const firstOfBatch = !(await tx.document.findFirst({
      where: {
        matterId: input.matterId,
        portalUploaderId: input.identityId,
        portalBatchId: input.batchId,
      },
      select: { id: true },
    }));
    const doc = await tx.document.create({
      data: {
        matterId: input.matterId,
        folderId,
        name: input.filename,
        category: "other",
        source: "portal",
        fileUrl: input.storageKey,
        contentType: input.contentType,
        fileSize: input.size,
        uploadedBy: null,
        portalUploaderId: input.identityId,
        portalBatchId: input.batchId,
        documentRequestId: linked ? input.requestId : null,
      },
      select: { id: true },
    });
    return {
      kind: "created",
      documentId: doc.id,
      requestClosed: Boolean(input.requestId) && !linked,
      firstOfBatch,
    };
  });

  if (outcome.kind === "existing") {
    return { ok: true, documentId: outcome.documentId, requestClosed: false };
  }
  if (outcome.kind === "refused") {
    await discard(input.storageKey, "access refused at completion");
    return { ok: false, error: outcome.error };
  }

  await logPortalEvent({
    identityId: input.identityId,
    matterId: input.matterId,
    title: "Client uploaded a document",
    detail:
      `uploaded ${input.filename}` +
      (outcome.requestClosed ? " (the request was closed; filed unlinked)" : "") +
      (note ? `; note: ${note}` : ""),
  });

  if (outcome.firstOfBatch) await notifyTeam(input);

  try {
    revalidatePath(`/matters/${input.matterId}/documents`);
    revalidatePath(`/matters/${input.matterId}`);
    revalidatePath(`/portal/matters/${input.matterId}`);
  } catch (err) {
    console.error("[portal-upload] revalidate failed", err);
  }

  return {
    ok: true,
    documentId: outcome.documentId,
    requestClosed: outcome.requestClosed,
  };
}

async function notifyTeam(input: RecordPortalUploadInput): Promise<void> {
  try {
    const [members, matter, identity] = await Promise.all([
      prisma.matterTeamMember.findMany({
        where: { matterId: input.matterId, removedAt: null },
        select: { userId: true },
      }),
      prisma.matter.findUnique({
        where: { id: input.matterId },
        select: { name: true },
      }),
      prisma.portalIdentity.findUnique({
        where: { id: input.identityId },
        select: { contact: { select: { name: true } } },
      }),
    ]);
    const who = identity?.contact.name ?? "A client";
    await createNotifications(
      members.map((m) => m.userId),
      {
        type: "portal_upload",
        title: `${who} uploaded documents`,
        body: matter?.name ?? null,
        link: `/matters/${input.matterId}/documents`,
        matterId: input.matterId,
      }
    );
  } catch (err) {
    console.error("[portal-upload] notify failed", err);
  }
}
