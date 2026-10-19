/**
 * POST /api/documents/upload
 *
 * Streaming multi-file upload — the write path for the discovery
 * document viewer (folder trees full of PDFs + GB-scale bodycam /
 * deposition media).
 *
 * Why a route handler and not a server action (a sanctioned
 * exception, like ../[id]/download): server actions materialize the
 * whole FormData in memory and Next caps the action body at ~1 MB by
 * default (`serverActions.bodySizeLimit`). Route handlers get the
 * raw request; we parse the multipart body as a *stream* with busboy
 * and pipe each file part straight to disk via `storeStream`.
 * `request.formData()` is deliberately NOT used — undici buffers
 * every part in memory before returning, which is exactly the
 * failure mode we're routing around. Peak memory here is a handful
 * of stream highWaterMark chunks (tens of KB), independent of file
 * size.
 *
 * CONTRACT (the folder UI + viewer build against this):
 *   multipart/form-data fields, in append order:
 *     - matterId  string — exactly one of matterId / leadId is
 *     - leadId    string   required (intake lead scope); MUST
 *                 precede any file part
 *     - folderId  string, optional — must belong to the same matter
 *                 or lead
 *     - recordsRequestId string, optional — tags the files as
 *                 received records of that request (must belong to the
 *                 same matter or lead; needs `records.edit`); files
 *                 default into Investigation/Records Requests/<custodian — type>. MUST
 *                 precede any file part
 *     - recordsRole string, optional — "request_letter" or
 *                 "received_records" (default); picks the Request /
 *                 Responsive documents subfolder and the tag. Anything
 *                 else is a 400. MUST precede any file part
 *     - category  string, optional — one of DOCUMENT_CATEGORIES;
 *                 defaults to "discovery" (batch uploads)
 *     - name      string, optional — display-name override, applied
 *                 only when the request carries exactly one file
 *     - files     one or more file parts (field name "files"); ≥1
 *   200 → { documents: [{ id: string, name: string }] }
 *   4xx → { error: string }
 *
 * Field order matters because target validation runs before the
 * first file byte is written to disk. Browsers encode FormData parts
 * in append order, so the client just appends matterId/folderId
 * before the files.
 *
 * Batch semantics are all-or-nothing: any rejected file (over cap,
 * empty) fails the request and removes everything already written.
 *
 * Auth: session (401) + `documents.upload` (403). The permission
 * gate uses `currentUserHasPermission` rather than
 * `requirePermission` because the latter `redirect("/")`s on denial
 * — the wrong shape for a JSON API consumed via fetch.
 *
 * MIME: server-resolved from the filename extension
 * (`contentTypeForFilename`); the client-declared part type is
 * ignored. Unknown extensions store as application/octet-stream,
 * which the download route serves as attachment-only.
 *
 * LOCAL STORAGE DRIVER ONLY (501 otherwise). Under the vercel-blob
 * driver, uploads go client-direct via ./blob/route.ts — prod
 * serverless bodies cap at ~4.5MB, so this route physically cannot
 * receive GB media on Vercel. This route is NOT dead code though:
 * blob's `onUploadCompleted` callback can't reach localhost, so
 * local dev keeps uploading through here (see ./blob/blob-upload.ts
 * for the full story). The uploader component picks its path from
 * the active driver.
 */

import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import busboy from "busboy";
import { NextResponse, type NextRequest } from "next/server";
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
import { resolveLeadUploadTarget } from "@/lib/lead-documents";
import { resolveRecordsUpload } from "@/lib/records-requests/folder";
import {
  isRecordsDocRole,
  type RecordsDocRole,
} from "@/lib/records-requests/roles";
import { extractIfEmail } from "@/lib/email-attachment-extract";
import {
  FileTooLargeError,
  activeStorageDriver,
  deleteFile,
  storeStream,
} from "@/lib/file-storage";
import { parseUploadMeta, type DocumentCategory } from "@/lib/document-form";
import {
  MAX_FILES_PER_BATCH,
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
  UPLOAD_FOLDER_SCOPE_ERROR,
  UPLOAD_RECORDS_REQUEST_SCOPE_ERROR,
  UPLOAD_SCOPE_REQUIRED_ERROR,
  capDocumentName,
  contentTypeForFilename,
  isMediaType,
} from "./upload-config";

// Never cache, always run per-request — this is a mutation.
export const dynamic = "force-dynamic";

type StoredUpload = {
  key: string;
  size: number;
  name: string;
  contentType: string;
};

type UploadFailure = { status: number; error: string };

type ParseResult =
  | {
      ok: true;
      scope: RecordScope;
      folderId: string | null;
      recordsRequestId: string | null;
      recordsRole: RecordsDocRole;
      category: DocumentCategory;
      displayName: string;
      files: StoredUpload[];
    }
  | (UploadFailure & {
      ok: false;
      /** Files already written before the failure — the caller
       *  unlinks them (all-or-nothing batches). */
      stored: StoredUpload[];
    });

export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const allowed = await currentUserHasPermission("documents.upload");
  if (!allowed) {
    return NextResponse.json(
      { error: "You don't have permission to upload documents." },
      { status: 403 }
    );
  }

  // Streaming-to-disk only makes sense on the local driver; under
  // vercel-blob the uploader goes client-direct instead. A stale
  // client hitting this anyway gets a clear 501, not a silent write
  // to an ephemeral serverless filesystem.
  if (activeStorageDriver() !== "local") {
    return NextResponse.json(
      {
        error:
          "This deployment uses client-direct uploads — POST /api/documents/upload/blob.",
      },
      { status: 501 }
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (
    !contentType.toLowerCase().includes("multipart/form-data") ||
    !req.body
  ) {
    return NextResponse.json(
      { error: "Expected a multipart/form-data body." },
      { status: 400 }
    );
  }

  const result = await parseAndStore(
    req.body as unknown as WebReadableStream<Uint8Array>,
    contentType,
    userId
  );

  if (!result.ok) {
    await Promise.all(result.stored.map((f) => deleteFile(f.key)));
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  let documents: { id: string; name: string; contentType: string | null }[];
  let scope: RecordScope = result.scope;
  // Set when a records tag was requested but the request no longer
  // matches the final scope (e.g. re-homed by a lead conversion).
  let recordsTagDropped = false;
  type RecordsTag = Awaited<ReturnType<typeof resolveRecordsUpload>>;
  const rowData = (
    f: StoredUpload,
    target: RecordScope,
    folderId: string | null,
    tag: RecordsTag = null
  ) => ({
    ...scopeWhere(target),
    folderId: tag ? tag.folderId : folderId,
    ...(tag
      ? {
          recordsRequestId: tag.recordsRequestId,
          recordsRequestRole: tag.recordsRequestRole,
        }
      : {}),
    // A display-name override only makes sense for a single
    // file; batches keep each file's own name.
    name:
      result.files.length === 1 && result.displayName
        ? capDocumentName(result.displayName)
        : f.name,
    // Default "discovery": the batch uploader exists for
    // discovery productions; the single-file composer sends
    // an explicit category.
    category: result.category,
    source: "upload" as const,
    fileUrl: f.key,
    contentType: f.contentType,
    fileSize: f.size,
    uploadedBy: userId,
  });
  const select = { id: true, name: true, contentType: true } as const;
  try {
    if (result.scope.kind === "lead") {
      // Lead scope: re-check the lead INSIDE the create transaction
      // under a FOR SHARE lock (resolveLeadUploadTarget). If it
      // converted while the bytes streamed, the files go onto its
      // matter (folder falls back to the matter root) rather than
      // being stranded on a read-only lead.
      const leadId = result.scope.leadId;
      const outcome = await prisma.$transaction(async (tx) => {
        const target = await resolveLeadUploadTarget(
          tx,
          leadId,
          userId,
          result.folderId,
          canAccessMatter
        );
        if (target.kind !== "filed") return target;
        // Re-check the request against the FINAL scope: after a
        // conversion it has been re-homed to the matter too. If it no
        // longer matches, file untagged rather than fail the upload.
        const tag = result.recordsRequestId
          ? await resolveRecordsUpload(
              tx,
              result.recordsRequestId,
              target.scope,
              target.folderId,
              result.recordsRole
            )
          : null;
        const dropped = Boolean(result.recordsRequestId) && !tag;
        const docs = [];
        for (const f of result.files) {
          docs.push(
            await tx.document.create({
              data: rowData(f, target.scope, target.folderId, tag),
              select,
            })
          );
        }
        return { ...target, docs, dropped };
      });
      if (outcome.kind !== "filed") {
        await Promise.all(result.files.map((f) => deleteFile(f.key)));
        return outcome.kind === "gone"
          ? NextResponse.json({ error: "Lead not found." }, { status: 404 })
          : NextResponse.json(
              {
                error:
                  "This lead was converted to a matter you don't have access to; the upload was discarded.",
              },
              { status: 403 }
            );
      }
      scope = outcome.scope;
      documents = outcome.docs;
      recordsTagDropped = outcome.dropped;
    } else if (result.recordsRequestId) {
      const requestId = result.recordsRequestId;
      const matterScope = result.scope;
      documents = await prisma.$transaction(async (tx) => {
        const tag = await resolveRecordsUpload(
          tx,
          requestId,
          matterScope,
          result.folderId,
          result.recordsRole
        );
        recordsTagDropped = !tag;
        const docs = [];
        for (const f of result.files) {
          docs.push(
            await tx.document.create({
              data: rowData(f, matterScope, result.folderId, tag),
              select,
            })
          );
        }
        return docs;
      });
    } else {
      // One transaction so a mid-batch DB failure can't leave half the
      // rows behind while the caller sees a 500.
      documents = await prisma.$transaction(
        result.files.map((f) =>
          prisma.document.create({
            data: rowData(f, result.scope, result.folderId),
            select,
          })
        )
      );
    }
  } catch (err) {
    // Bytes without rows are orphans — remove them before failing.
    await Promise.all(result.files.map((f) => deleteFile(f.key)));
    throw err;
  }

  // ONE activity entry per batch — a 40-file production must not
  // flood the recent-activity feed with 40 rows.
  await logActivity({
    matterId: scope.kind === "matter" ? scope.matterId : null,
    userId,
    type: "document",
    title:
      documents.length === 1
        ? "Document uploaded"
        : `${documents.length} documents uploaded`,
    detail: (
      documents.map((d) => d.name).join(", ") +
      (recordsTagDropped
        ? " (records request no longer matched; filed without the records tag)"
        : "")
    ).slice(0, 500),
  });

  // Emails: their attachments become documents under them (ADR-043).
  // Best-effort — the upload itself has succeeded either way.
  for (const d of documents) await extractIfEmail(d, userId);

  revalidateDocumentScope(scope);

  return NextResponse.json({ documents });
}

type Target = {
  scope: RecordScope;
  folderId: string | null;
  recordsRequestId: string | null;
  recordsRole: RecordsDocRole;
  category: DocumentCategory;
  displayName: string;
};

/** Validate the matterId/folderId/category/name fields once, before
 *  the first file byte hits disk. */
async function resolveTarget(
  userId: string,
  fields: {
    matterId?: string;
    leadId?: string;
    folderId?: string;
    recordsRequestId?: string;
    recordsRole?: string;
    category?: string;
    name?: string;
  }
): Promise<Target | UploadFailure> {
  const meta = parseUploadMeta({
    name: fields.name,
    category: fields.category?.trim() || "discovery",
  });
  if (!meta) {
    return { status: 400, error: "Invalid document name or category." };
  }
  const roleField = fields.recordsRole?.trim();
  if (roleField && !isRecordsDocRole(roleField)) {
    return { status: 400, error: "Invalid records document kind." };
  }
  const recordsRole: RecordsDocRole = isRecordsDocRole(roleField)
    ? roleField
    : "received_records";
  const matterId = fields.matterId?.trim();
  const leadId = fields.leadId?.trim();
  if ((matterId && leadId) || (!matterId && !leadId)) {
    return { status: 400, error: UPLOAD_SCOPE_REQUIRED_ERROR };
  }

  let scope: RecordScope;
  if (matterId) {
    // TODO (multi-tenant): scope by firmId once Matter carries one
    // (single-tenant today; see the download route's ACCESS MODEL).
    const matter = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { id: true },
    });
    // Matter wall: a hidden matter is "not found" (404), same as a
    // missing one - checked before the first byte is written.
    if (!matter || !(await canAccessMatter(userId, matterId))) {
      return { status: 404, error: "Matter not found." };
    }
    scope = { kind: "matter", matterId };
  } else if (leadId) {
    // Lead wall (restricted intake, ADR-049): hidden == missing. The
    // lead must also be unconverted (its records moved to the matter).
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });
    if (!lead || !(await canAccessLead(userId, leadId))) {
      return { status: 404, error: "Lead not found." };
    }
    scope = { kind: "lead", leadId: lead.id };
    const readOnly = await assertScopeWritable(scope);
    if (readOnly) return { status: 409, error: readOnly };
  } else {
    return { status: 400, error: UPLOAD_SCOPE_REQUIRED_ERROR };
  }

  const folderId = fields.folderId?.trim();
  if (folderId) {
    // Scoped find — a folderId from a *different* matter or lead
    // must not let files leak into that tree.
    const folder = await prisma.documentFolder.findFirst({
      where: { id: folderId, ...scopeWhere(scope) },
      select: { id: true },
    });
    if (!folder) {
      return { status: 400, error: UPLOAD_FOLDER_SCOPE_ERROR };
    }
  }

  // Linking to a records request: caller must be able to edit records
  // and the request must live in THIS scope - checked before any byte.
  const recordsRequestId = fields.recordsRequestId?.trim() || null;
  if (recordsRequestId) {
    if (!(await currentUserHasPermission("records.edit"))) {
      return {
        status: 403,
        error: "You don't have permission to link documents to records requests.",
      };
    }
    const request = await prisma.recordsRequest.findFirst({
      where: { id: recordsRequestId, ...scopeWhere(scope) },
      select: { id: true },
    });
    if (!request) {
      return { status: 400, error: UPLOAD_RECORDS_REQUEST_SCOPE_ERROR };
    }
  }
  return {
    scope,
    folderId: folderId || null,
    recordsRequestId,
    recordsRole,
    category: meta.category,
    displayName: meta.name,
  };
}

/**
 * Stream-parse the multipart body, writing each file part to storage
 * as it arrives. File parts are processed strictly in order (the
 * `chain` promise) — multipart parts are sequential on the wire, and
 * busboy applies backpressure while a part stream goes unconsumed,
 * so awaiting DB validation inside the handler simply pauses the
 * upload.
 *
 * On the first failure we stop reading the client's bytes entirely
 * (destroy the source) instead of draining a potentially huge
 * remainder we already know we'll reject.
 */
async function parseAndStore(
  body: WebReadableStream<Uint8Array>,
  contentTypeHeader: string,
  userId: string
): Promise<ParseResult> {
  const stored: StoredUpload[] = [];

  let bb: busboy.Busboy;
  try {
    bb = busboy({
      headers: { "content-type": contentTypeHeader },
      // Browsers send multipart filenames as raw UTF-8; busboy's
      // default 'latin1' turns "Déposition.pdf" into mojibake.
      defParamCharset: "utf8",
      limits: {
        files: MAX_FILES_PER_BATCH,
        fields: 20,
        fieldSize: 4 * 1024, // ids, not payloads
      },
    });
  } catch {
    // busboy throws synchronously on a missing/broken boundary.
    return {
      ok: false,
      status: 400,
      error: "Malformed multipart body.",
      stored,
    };
  }

  const source = Readable.fromWeb(body);
  const fields: {
    matterId?: string;
    leadId?: string;
    folderId?: string;
    recordsRequestId?: string;
    recordsRole?: string;
    category?: string;
    name?: string;
  } = {};
  let target: Target | null = null;
  let failure: UploadFailure | null = null;
  let chain: Promise<void> = Promise.resolve();
  let sawFilePart = false;

  await new Promise<void>((resolve) => {
    let settled = false;
    // Resolve once the current chain drains. Safe to call from
    // 'close'/'error': every 'file' event precedes them, so the
    // chain can no longer grow.
    const settleAfterChain = () => {
      if (settled) return;
      settled = true;
      void chain.then(resolve, resolve);
    };
    const fail = (f: UploadFailure) => {
      if (!failure) failure = f;
    };

    bb.on("field", (name, value) => {
      if (name === "recordsRequestId" && sawFilePart && value.trim()) {
        // Target validation already ran on the earlier fields; a late
        // id would otherwise be silently ignored (untagged upload).
        fail({
          status: 400,
          error: "recordsRequestId must precede file parts in the form data.",
        });
        return;
      }
      if (name === "recordsRole" && sawFilePart && value.trim()) {
        fail({
          status: 400,
          error: "recordsRole must precede file parts in the form data.",
        });
        return;
      }
      if (
        name === "matterId" ||
        name === "leadId" ||
        name === "folderId" ||
        name === "recordsRequestId" ||
        name === "recordsRole" ||
        name === "category" ||
        name === "name"
      ) {
        fields[name] = value;
      }
    });

    bb.on("file", (name, stream, info) => {
      sawFilePart = true;
      chain = chain.then(async () => {
        if (failure) {
          stream.resume();
          return;
        }
        if (name !== "files") {
          // Unknown file field — drain and ignore rather than
          // failing a batch over a stray part.
          stream.resume();
          return;
        }
        const filename = capDocumentName((info.filename ?? "").trim());
        if (!filename) {
          // An empty <input type="file"> submits a nameless empty
          // part — skip it; the zero-files check below still fires.
          stream.resume();
          return;
        }

        if (!target) {
          const resolved = await resolveTarget(userId, fields);
          if ("error" in resolved) {
            fail(resolved);
            stream.resume();
            return;
          }
          target = resolved;
        }

        const resolvedType = contentTypeForFilename(filename);
        const cap = isMediaType(resolvedType)
          ? MAX_MEDIA_UPLOAD_BYTES
          : MAX_STANDARD_UPLOAD_BYTES;

        // A failed pipeline destroys busboy's part stream and busboy
        // may still push into it — swallow the post-mortem error so
        // it can't crash the process.
        stream.on("error", () => {});

        try {
          const s = await storeStream(stream, filename, cap);
          if (s.size === 0) {
            await deleteFile(s.key);
            fail({ status: 400, error: `"${filename}" is empty.` });
            return;
          }
          stored.push({
            key: s.key,
            size: s.size,
            name: filename,
            contentType: resolvedType,
          });
        } catch (err) {
          if (err instanceof FileTooLargeError) {
            const capMiB = Math.floor(cap / (1024 * 1024));
            fail({
              status: 413,
              error: `"${filename}" is too large (max ${capMiB} MiB for ${
                isMediaType(resolvedType) ? "media" : "this file type"
              }).`,
            });
          } else {
            fail({
              status: 500,
              error: "Upload failed while writing to storage.",
            });
          }
        }
      }).catch(() => {
        // Unexpected throw (e.g. the DB lookup inside resolveTarget)
        // — fail the batch but keep the chain resolved so teardown
        // and the settle path still run.
        fail({ status: 500, error: "Upload failed." });
        try {
          stream.resume();
        } catch {
          /* part stream already destroyed */
        }
      });

      // After each file settles: if the batch is dead, stop pulling
      // the client's remaining bytes.
      chain = chain.then(() => {
        if (failure && !settled) {
          source.unpipe(bb);
          source.destroy();
          settleAfterChain();
        }
      });
    });

    bb.on("filesLimit", () => {
      fail({
        status: 400,
        error: `Too many files (max ${MAX_FILES_PER_BATCH} per upload).`,
      });
    });
    bb.on("error", () => {
      fail({ status: 400, error: "Malformed multipart body." });
      settleAfterChain();
    });
    bb.on("close", settleAfterChain);
    // The client went away mid-upload (closed tab, cancel). pipe()
    // does not end or destroy the destination when the source errors,
    // so busboy's open file stream would never finish: the part's
    // pipeline would wait forever and keep a partial file on disk.
    // Destroying busboy errors the current part stream, which makes
    // storeStream's pipeline reject and unlink its partial file.
    source.on("error", () => {
      source.unpipe(bb);
      bb.destroy();
      settleAfterChain();
    });

    source.pipe(bb);
  });

  if (!failure && stored.length === 0) {
    failure = { status: 400, error: "No files in the upload." };
  }
  if (failure) {
    return { ok: false, ...failure, stored };
  }
  // target is non-null here: stored.length > 0 implies at least one
  // file was processed, which requires a resolved target.
  const t = target as unknown as Target;
  return {
    ok: true,
    scope: t.scope,
    folderId: t.folderId,
    recordsRequestId: t.recordsRequestId,
    recordsRole: t.recordsRole,
    category: t.category,
    displayName: t.displayName,
    files: stored,
  };
}
