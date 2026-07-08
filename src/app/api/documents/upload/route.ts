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
 *     - matterId  string, required — MUST precede any file part
 *     - folderId  string, optional — must belong to the same matter
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
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { currentUserHasPermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import {
  FileTooLargeError,
  activeStorageDriver,
  deleteFile,
  storeStream,
} from "@/lib/file-storage";
import {
  MAX_FILES_PER_BATCH,
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
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
      matterId: string;
      folderId: string | null;
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
    contentType
  );

  if (!result.ok) {
    await Promise.all(result.stored.map((f) => deleteFile(f.key)));
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  let documents: { id: string; name: string }[];
  try {
    // One transaction so a mid-batch DB failure can't leave half the
    // rows behind while the caller sees a 500.
    documents = await prisma.$transaction(
      result.files.map((f) =>
        prisma.document.create({
          data: {
            matterId: result.matterId,
            folderId: result.folderId,
            name: f.name,
            // "discovery" is in DOCUMENT_CATEGORIES — this route
            // exists for discovery productions; re-categorizing is a
            // documents-tab edit.
            category: "discovery",
            source: "upload",
            fileUrl: f.key,
            contentType: f.contentType,
            fileSize: f.size,
            uploadedBy: userId,
          },
          select: { id: true, name: true },
        })
      )
    );
  } catch (err) {
    // Bytes without rows are orphans — remove them before failing.
    await Promise.all(result.files.map((f) => deleteFile(f.key)));
    throw err;
  }

  // ONE activity entry per batch — a 40-file production must not
  // flood the recent-activity feed with 40 rows.
  await logActivity({
    matterId: result.matterId,
    userId,
    type: "document",
    title:
      documents.length === 1
        ? "Document uploaded"
        : `${documents.length} documents uploaded`,
    detail: documents
      .map((d) => d.name)
      .join(", ")
      .slice(0, 500),
  });

  revalidatePath(`/matters/${result.matterId}/documents`);
  revalidatePath(`/matters/${result.matterId}`);

  return NextResponse.json({ documents });
}

/** Validate the matterId/folderId fields once, before the first
 *  file byte hits disk. */
async function resolveTarget(fields: {
  matterId?: string;
  folderId?: string;
}): Promise<{ matterId: string; folderId: string | null } | UploadFailure> {
  const matterId = fields.matterId?.trim();
  if (!matterId) {
    return {
      status: 400,
      error:
        "matterId is required and must precede file parts in the form data.",
    };
  }
  // TODO (multi-tenant): scope by firmId once Matter carries one —
  // same caveat as the uploadDocument server action.
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  if (!matter) return { status: 404, error: "Matter not found." };

  const folderId = fields.folderId?.trim();
  if (folderId) {
    // Scoped find — a folderId from a *different* matter must not
    // let files leak into that matter's tree.
    const folder = await prisma.documentFolder.findFirst({
      where: { id: folderId, matterId },
      select: { id: true },
    });
    if (!folder) {
      return { status: 400, error: "Folder not found in this matter." };
    }
  }
  return { matterId, folderId: folderId || null };
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
  contentTypeHeader: string
): Promise<ParseResult> {
  const stored: StoredUpload[] = [];

  let bb: busboy.Busboy;
  try {
    bb = busboy({
      headers: { "content-type": contentTypeHeader },
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
  const fields: { matterId?: string; folderId?: string } = {};
  let target: { matterId: string; folderId: string | null } | null = null;
  let failure: UploadFailure | null = null;
  let chain: Promise<void> = Promise.resolve();

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
      if (name === "matterId" || name === "folderId") {
        fields[name] = value;
      }
    });

    bb.on("file", (name, stream, info) => {
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
        const filename = (info.filename ?? "").trim();
        if (!filename) {
          // An empty <input type="file"> submits a nameless empty
          // part — skip it; the zero-files check below still fires.
          stream.resume();
          return;
        }

        if (!target) {
          const resolved = await resolveTarget(fields);
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
    source.on("error", settleAfterChain);

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
  const t = target as unknown as { matterId: string; folderId: string | null };
  return { ok: true, matterId: t.matterId, folderId: t.folderId, files: stored };
}
