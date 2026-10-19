/**
 * Client-direct blob upload — the `handleUpload` callbacks, split
 * out of route.ts so they're unit-testable (Next restricts route
 * files to route exports; same pattern as ../upload-config.ts).
 *
 * Flow (@vercel/blob/client):
 *   1. Browser asks THIS route for a scoped one-time client token
 *      (`blob.generate-client-token` event → `onBeforeGenerateToken`).
 *      All authorization happens HERE — session, `documents.upload`
 *      permission, matter/folder validation — because step 3 has no
 *      user session to check.
 *   2. Browser PUTs the file straight to Vercel Blob with that
 *      token. The bytes never touch our serverless functions, which
 *      is the whole point: prod request bodies cap at ~4.5MB, and
 *      discovery media runs to gigabytes.
 *   3. Vercel Blob calls THIS route back (`blob.upload-completed`,
 *      signature-verified by `handleUpload`) → `onUploadCompleted`
 *      creates the Document row + audit entry. Identity comes from
 *      `tokenPayload`, which WE wrote in step 1 — the client never
 *      supplies it.
 *
 * IMPORTANT — why the streaming route (../route.ts) still exists:
 * step 3 arrives over the PUBLIC INTERNET from Vercel's
 * infrastructure. On localhost there is no public URL to call back,
 * so `onUploadCompleted` never fires and no Document row would ever
 * be created. Local dev therefore stays on the `local` storage
 * driver + the busboy streaming route; this path is production-only
 * by construction. (Testing it locally requires a tunnel, e.g.
 * `ngrok` + VERCEL_BLOB_CALLBACK_URL.)
 *
 * Auth gate uses `currentUserHasPermission`, not `requirePermission`
 * — the latter `redirect()`s, the wrong shape for a JSON API.
 *
 * MIME rule matches the streaming route: server-derived from the
 * pathname's extension (`contentTypeForFilename`); the token's
 * `allowedContentTypes` pins the upload to exactly that type, and
 * the uploader derives its declared type from the same shared
 * function, so the two can never disagree.
 */

import { del, head } from "@vercel/blob";
import type { HandleUploadOptions } from "@vercel/blob/client";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessMatter } from "@/lib/matter-access";
import { canAccessLead } from "@/lib/lead-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import {
  assertScopeWritable,
  revalidateDocumentScope,
} from "@/lib/scope-access";
import { extractIfEmail } from "@/lib/email-attachment-extract";
import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
} from "@/lib/document-form";
import { isValidStorageKey } from "@/lib/storage/storage-key";
import { resolveLeadUploadTarget } from "@/lib/lead-documents";
import { resolveRecordsUpload } from "@/lib/records-requests/folder";
import {
  isRecordsDocRole,
  type RecordsDocRole,
} from "@/lib/records-requests/roles";
import { BLOB_CACHE_MAX_AGE_SECONDS } from "@/lib/storage/blob-driver";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
  UPLOAD_FOLDER_SCOPE_ERROR,
  UPLOAD_RECORDS_REQUEST_SCOPE_ERROR,
  UPLOAD_SCOPE_REQUIRED_ERROR,
  contentTypeForFilename,
  isMediaType,
} from "../upload-config";

/** Carries an HTTP status so route.ts can answer 401/403/404
 *  instead of a blanket 400 when a callback rejects. */
export class UploadTokenError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadTokenError";
    this.status = status;
  }
}

/** What the browser sends alongside the token request. Same target
 *  contract as the streaming route's form fields. */
const clientPayloadSchema = z
  .object({
    /** Exactly one of matterId / leadId (refined below). */
    matterId: z.string().min(1).optional(),
    leadId: z.string().min(1).optional(),
    folderId: z.string().min(1).nullish(),
    /** Tag the file as received records of this request (must be in
     *  the same scope; needs records.edit). */
    recordsRequestId: z.string().min(1).nullish(),
    /** Which records section the file belongs to; validated against
     *  RECORDS_DOC_ROLES below (default received_records). */
    recordsRole: z.string().nullish(),
    /** Document display name: the original filename, or the composer's
     *  override. The pathname
     *  is the sanitized/truncated KEY; this preserves what the user
     *  actually called the file. */
    name: z.string().trim().min(1).max(255),
    /** Single-file composer's category; batch uploads omit it
     *  (→ "discovery", same default as the streaming route). */
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
  })
  .refine((p) => Boolean(p.matterId) !== Boolean(p.leadId), {
    message: UPLOAD_SCOPE_REQUIRED_ERROR,
  });

/** Token lifetimes. The SDK default is ONE hour, fixed at mint time
 *  and reused for every multipart part, so a 2 GiB recording on an
 *  ordinary office uplink (~70 minutes) would expire mid-transfer.
 *  Media gets a long window; everything else keeps the default. */
const TOKEN_TTL_MS = 60 * 60 * 1000;
const MEDIA_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** Round-trips from token generation to the completion callback —
 *  signed into the client token by `handleUpload`, so the uploader
 *  can't tamper with it. */
type TokenPayload = {
  /** Exactly one of matterId / leadId is set. */
  matterId?: string;
  leadId?: string;
  folderId: string | null;
  recordsRequestId?: string | null;
  recordsRole?: RecordsDocRole;
  name: string;
  category: DocumentCategory;
  contentType: string;
  userId: string;
};

export const onBeforeGenerateToken: HandleUploadOptions["onBeforeGenerateToken"] =
  async (pathname, clientPayload) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw new UploadTokenError(401, "Unauthorized");
    }
    const allowed = await currentUserHasPermission("documents.upload");
    if (!allowed) {
      throw new UploadTokenError(
        403,
        "You don't have permission to upload documents.",
      );
    }

    // The client proposes its own pathname (it generates the key
    // before asking us) — accept only our `{rand16}__{name}` shape.
    // Anything else could nest "folders" or collide on purpose;
    // `allowOverwrite: false` below is the backstop either way.
    if (!isValidStorageKey(pathname)) {
      throw new UploadTokenError(400, "Invalid upload pathname.");
    }

    let payload: z.infer<typeof clientPayloadSchema>;
    try {
      payload = clientPayloadSchema.parse(JSON.parse(clientPayload ?? ""));
    } catch {
      throw new UploadTokenError(400, "Invalid upload payload.");
    }

    if (
      payload.recordsRole != null &&
      payload.recordsRole !== "" &&
      !isRecordsDocRole(payload.recordsRole)
    ) {
      throw new UploadTokenError(400, "Invalid records document kind.");
    }
    const recordsRole: RecordsDocRole = isRecordsDocRole(payload.recordsRole)
      ? payload.recordsRole
      : "received_records";

    // Same target validation as the streaming route's resolveTarget.
    let scope: RecordScope;
    if (payload.matterId) {
      // TODO (multi-tenant): scope by firmId once Matter carries one.
      const matter = await prisma.matter.findUnique({
        where: { id: payload.matterId },
        select: { id: true },
      });
      // Matter wall: hidden == missing, before any token is issued.
      if (
        !matter ||
        !(await canAccessMatter(session.user.id, payload.matterId))
      ) {
        throw new UploadTokenError(404, "Matter not found.");
      }
      scope = { kind: "matter", matterId: payload.matterId };
    } else if (payload.leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: payload.leadId },
        select: { id: true },
      });
      // Lead wall (ADR-049): hidden == missing, before any token.
      if (
        !lead ||
        !(await canAccessLead(session.user.id, payload.leadId))
      ) {
        throw new UploadTokenError(404, "Lead not found.");
      }
      scope = { kind: "lead", leadId: lead.id };
      const readOnly = await assertScopeWritable(scope);
      if (readOnly) throw new UploadTokenError(409, readOnly);
    } else {
      throw new UploadTokenError(400, UPLOAD_SCOPE_REQUIRED_ERROR);
    }

    const folderId = payload.folderId ?? null;
    if (folderId) {
      // Scoped find — a folderId from a *different* matter or lead
      // must not let files leak into that tree.
      const folder = await prisma.documentFolder.findFirst({
        where: { id: folderId, ...scopeWhere(scope) },
        select: { id: true },
      });
      if (!folder) {
        throw new UploadTokenError(400, UPLOAD_FOLDER_SCOPE_ERROR);
      }
    }

    const recordsRequestId = payload.recordsRequestId ?? null;
    if (recordsRequestId) {
      if (!(await currentUserHasPermission("records.edit"))) {
        throw new UploadTokenError(
          403,
          "You don't have permission to link documents to records requests.",
        );
      }
      const request = await prisma.recordsRequest.findFirst({
        where: { id: recordsRequestId, ...scopeWhere(scope) },
        select: { id: true },
      });
      if (!request) {
        throw new UploadTokenError(400, UPLOAD_RECORDS_REQUEST_SCOPE_ERROR);
      }
    }

    // Server-derived MIME from the key's extension — the same rule
    // (and the same function) as the streaming route. The token pins
    // the upload to exactly this type + this size cap; a client
    // declaring anything else is rejected by Vercel Blob itself.
    const contentType = contentTypeForFilename(pathname);
    const maximumSizeInBytes = isMediaType(contentType)
      ? MAX_MEDIA_UPLOAD_BYTES
      : MAX_STANDARD_UPLOAD_BYTES;

    const tokenPayload: TokenPayload = {
      ...scopeWhere(scope),
      folderId,
      ...(recordsRequestId ? { recordsRequestId, recordsRole } : {}),
      name: payload.name,
      category: payload.category ?? "discovery",
      contentType,
      userId: session.user.id,
    };

    return {
      allowedContentTypes: [contentType],
      maximumSizeInBytes,
      validUntil:
        Date.now() +
        (isMediaType(contentType) ? MEDIA_TOKEN_TTL_MS : TOKEN_TTL_MS),
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: BLOB_CACHE_MAX_AGE_SECONDS,
      tokenPayload: JSON.stringify(tokenPayload),
    };
  };

/** Prisma FK violation (the folder or matter vanished mid-upload). */
const isForeignKeyError = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: unknown }).code === "P2003";

/**
 * Vercel delivers this callback AT LEAST once and retries on any
 * non-2xx, so it must be idempotent and must not fail permanently
 * for a reason a retry can't fix:
 *   - a redelivery for a blob that already has a row is a no-op;
 *   - a matter deleted mid-upload leaves nothing to attach to: the
 *     orphan blob is removed and the callback succeeds;
 *   - a folder deleted mid-upload (deleteFolder only re-parents rows
 *     that exist) files the document at the matter root instead of
 *     failing the FK on every retry, and says so in the audit row.
 * Transient errors (DB down, head() failing) still throw so Vercel
 * retries them.
 */
export const onUploadCompleted: NonNullable<
  HandleUploadOptions["onUploadCompleted"]
> = async ({ blob, tokenPayload }) => {
  if (!tokenPayload) {
    throw new Error("Missing token payload on completed upload.");
  }
  // Trusted: we serialized it in onBeforeGenerateToken and
  // handleUpload verified the callback signature.
  const t = JSON.parse(tokenPayload) as TokenPayload;

  // A portal token (src/app/(portal)/portal/api/documents/upload/blob) is
  // signed with the same store token, so its callback would verify here if
  // it were ever misrouted. It names no staff uploader: never file it as a
  // staff document. Delete the blob and succeed so Vercel stops retrying.
  const shape = t as Partial<TokenPayload> & { kind?: unknown };
  if (shape.kind === "portal" || typeof shape.userId !== "string" || !shape.userId) {
    console.error("[blob-upload] non-staff token payload on the staff route; blob removed");
    await del(blob.url).catch(() => {});
    return;
  }

  // Redelivery: the row for this blob already exists.
  const existing = await prisma.document.findFirst({
    where: { fileUrl: blob.url },
    select: { id: true },
  });
  if (existing) return;

  // `blob` carries no size — probe for it (also confirms the bytes
  // actually landed before we write a row pointing at them).
  const meta = await head(blob.url);
  if (meta.size === 0) {
    // Parity with the streaming route: empty files never get rows.
    // Delete the empty blob and swallow — throwing would make
    // Vercel retry a callback that can never succeed.
    await del(blob.url).catch(() => {});
    return;
  }

  // Exactly one of matterId / leadId — we wrote it, but fail loud on
  // a payload that breaks the invariant rather than guess a scope.
  let scope: RecordScope;
  if (t.matterId && !t.leadId) {
    scope = { kind: "matter", matterId: t.matterId };
  } else if (t.leadId && !t.matterId) {
    scope = { kind: "lead", leadId: t.leadId };
  } else {
    throw new Error("Upload token payload must carry exactly one scope.");
  }

  const removeOrphan = async (why: string) => {
    console.error(`[blob-upload] ${why}; blob removed`, {
      ...scopeWhere(scope),
    });
    await del(blob.url).catch(() => {});
  };

  type RecordsTag = Awaited<ReturnType<typeof resolveRecordsUpload>>;
  // Set when a records tag was requested but the request no longer
  // matches the FINAL scope: the file is filed untagged, not failed.
  let recordsTagDropped = false;
  const resolveTag = async (
    tx: Parameters<typeof resolveRecordsUpload>[0],
    target: RecordScope,
    targetFolderId: string | null
  ): Promise<RecordsTag> => {
    if (!t.recordsRequestId) return null;
    const tag = await resolveRecordsUpload(
      tx,
      t.recordsRequestId,
      target,
      targetFolderId,
      t.recordsRole ?? "received_records"
    );
    recordsTagDropped = !tag;
    return tag;
  };

  const dataFor = (
    target: RecordScope,
    targetFolderId: string | null,
    tag: RecordsTag = null
  ) => ({
    ...scopeWhere(target),
    folderId: tag ? tag.folderId : targetFolderId,
    ...(tag
      ? {
          recordsRequestId: tag.recordsRequestId,
          recordsRequestRole: tag.recordsRequestRole,
        }
      : {}),
    name: t.name,
    // The composer picks a category; the multi-file uploader
    // sends none, and discovery productions are what it exists
    // for.
    category: t.category ?? "discovery",
    source: "upload" as const,
    // Full blob URL — the key under the vercel-blob driver
    // (storage-key.ts documents the mapping).
    fileUrl: blob.url,
    contentType: t.contentType,
    fileSize: meta.size,
    uploadedBy: t.userId,
  });

  let filedAtRoot = Boolean(t.folderId);
  let created: { id: string; name: string; contentType: string | null };

  if (scope.kind === "matter") {
    const matterId = scope.matterId;
    const matter = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { id: true },
    });
    if (!matter) {
      await removeOrphan("matter vanished during upload");
      return;
    }

    let folderId = t.folderId;
    if (folderId) {
      const folder = await prisma.documentFolder.findFirst({
        where: { id: folderId, ...scopeWhere(scope) },
        select: { id: true },
      });
      if (!folder) folderId = null;
    }
    filedAtRoot = Boolean(t.folderId) && folderId === null;
    const createMatterDoc = (f: string | null) =>
      t.recordsRequestId
        ? prisma.$transaction(async (tx) => {
            const tag = await resolveTag(tx, scope, f);
            return tx.document.create({ data: dataFor(scope, f, tag) });
          })
        : prisma.document.create({ data: dataFor(scope, f) });
    try {
      created = await createMatterDoc(folderId);
    } catch (err) {
      if (!isForeignKeyError(err)) throw err;
      // Raced a delete between the checks above and the insert.
      const stillThere = await prisma.matter.findUnique({
        where: { id: matterId },
        select: { id: true },
      });
      if (!stillThere) {
        await removeOrphan("matter vanished during upload");
        return;
      }
      created = await createMatterDoc(null);
      filedAtRoot = true;
    }
  } else {
    // Lead scope: decide the scope and create in ONE transaction that
    // holds a FOR SHARE lock on the lead row (see
    // resolveLeadUploadTarget), so a conversion can't slip between
    // the stage read and the insert. A lead converted mid-upload
    // reroutes the file onto its matter instead of discarding it.
    const leadId = scope.leadId;
    type Filed =
      | { kind: "filed"; scope: RecordScope; folderId: string | null; doc: typeof created }
      | { kind: "gone" }
      | { kind: "forbidden"; matterId: string };
    const fileOnLead = (folder: string | null): Promise<Filed> =>
      prisma.$transaction(async (tx) => {
        const target = await resolveLeadUploadTarget(
          tx,
          leadId,
          t.userId,
          folder,
          canAccessMatter
        );
        if (target.kind !== "filed") return target;
        const tag = await resolveTag(tx, target.scope, target.folderId);
        const doc = await tx.document.create({
          data: dataFor(target.scope, target.folderId, tag),
        });
        return { ...target, doc };
      });

    let filed: Filed;
    try {
      filed = await fileOnLead(t.folderId);
    } catch (err) {
      if (!isForeignKeyError(err)) throw err;
      // The folder (or the lead) vanished between the lookup and the
      // insert: retry at the root; a lead that is gone ends as "gone".
      filed = await fileOnLead(null);
    }
    if (filed.kind === "gone") {
      await removeOrphan("lead vanished during upload");
      return;
    }
    if (filed.kind === "forbidden") {
      // Converted, but the uploader can't see the new matter: filing
      // the file there would leak it past the matter wall. Fail
      // closed (and succeed the callback — a retry can't change it).
      await removeOrphan(
        `lead converted during upload to matter ${filed.matterId} the uploader cannot access`
      );
      return;
    }
    scope = filed.scope;
    created = filed.doc;
    filedAtRoot = Boolean(t.folderId) && filed.folderId === null;
  }

  // One activity row PER FILE — unlike the streaming route's
  // one-per-batch, because each client upload completes via its own
  // independent callback; there is no server-side batch to group.
  // Known trade-off (ADR-015): a 40-file production writes 40 rows.
  await logActivity({
    matterId: scope.kind === "matter" ? scope.matterId : null,
    leadId: scope.kind === "lead" ? scope.leadId : null,
    userId: t.userId,
    type: "document",
    title: "Document uploaded",
    detail: (
      (filedAtRoot
        ? `${t.name} (target folder was deleted during the upload; filed at the root)`
        : t.name) +
      (recordsTagDropped
        ? " (records request no longer matched; filed without the records tag)"
        : "")
    ).slice(0, 500),
  });

  // Emails: their attachments become documents under them (ADR-043).
  // Best-effort; never fails the callback.
  await extractIfEmail(created, t.userId);

  // The row exists now: a failure here must not fail the callback
  // (Vercel would retry and the guard above would just no-op).
  try {
    revalidateDocumentScope(scope);
  } catch (err) {
    console.error("[blob-upload] revalidate failed", err);
  }
};
