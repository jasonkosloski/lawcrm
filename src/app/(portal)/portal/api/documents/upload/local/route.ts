/**
 * POST /api/documents/upload/local on the PORTAL host (internally
 * /portal/api/documents/upload/local). The local-storage-driver path for
 * client uploads in development: Vercel Blob's completion webhook can't
 * reach localhost, so dev streams multipart here instead (same reason the
 * staff streaming route exists). 501 under the blob driver.
 *
 * Not at /api/documents/upload: the proxy matcher skips that exact path on
 * every host, so on the portal host it would never be rewritten and would
 * reach the staff route. This path IS proxied (the rewrite into /portal
 * needs it), and a proxied request body is buffered to at most 10 MB
 * (`proxyClientMaxBodySize`); past that the route sees a truncated body
 * and fails the batch as malformed. The uploader refuses batches over the
 * cap up front. Production uses the blob route.
 *
 * Contract (multipart/form-data, fields BEFORE any file part):
 *   matterId, batchId (uuid), requestId?, note?, then one or more `files`.
 *   200 -> { documents: [{ id, name, requestClosed }] }
 *   4xx -> { error }
 *
 * Gates: portal identity from the session (401), then the same target
 * checks as the blob token step (`checkPortalUploadTarget`) before the first
 * byte is stored, the type allowlist per file, and the daily cap for the
 * whole batch. Each stored file then goes through `recordPortalUpload`,
 * which re-checks access. Never redirects.
 */

import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import busboy from "busboy";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPortalIdentity } from "@/lib/portal-access";
import {
  FileTooLargeError,
  activeStorageDriver,
  deleteFile,
  storeStream,
} from "@/lib/file-storage";
import { checkPortalUpload } from "@/lib/portal/upload-policy";
import {
  PORTAL_UPLOAD_NOTE_MAX,
  checkPortalUploadTarget,
  recordPortalUpload,
} from "@/lib/portal/record-upload";
import { MAX_FILES_PER_BATCH, capDocumentName } from "@/app/api/documents/upload/upload-config";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Stored = { key: string; size: number; name: string; contentType: string };
type Failure = { status: number; error: string };
type Fields = { matterId?: string; batchId?: string; requestId?: string; note?: string };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: Request): Promise<Response> {
  const identity = await getPortalIdentity();
  if (!identity) return json({ error: "Please sign in again." }, 401);

  if (activeStorageDriver() !== "local") {
    return json({ error: "This deployment uses /api/documents/upload/blob." }, 501);
  }
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data") || !req.body) {
    return json({ error: "Expected a multipart/form-data body." }, 400);
  }

  const parsed = await parseAndStore(
    req.body as unknown as WebReadableStream<Uint8Array>,
    contentType,
    identity.identityId,
  );
  const removeAll = () => Promise.all(parsed.stored.map((f) => deleteFile(f.key).catch(() => {})));
  if ("error" in parsed.result) {
    await removeAll();
    return json({ error: parsed.result.error }, parsed.result.status);
  }
  const fields = parsed.result;

  // The whole batch must fit under the daily cap (and access may have
  // changed while the bytes streamed).
  const target = await checkPortalUploadTarget({
    identityId: identity.identityId,
    matterId: fields.matterId,
    requestId: fields.requestId,
    batchId: fields.batchId,
    adding: parsed.stored.length,
  });
  if (!target.ok) {
    await removeAll();
    return json({ error: target.error }, target.status);
  }

  const documents: { id: string; name: string; requestClosed: boolean }[] = [];
  const removeFrom = (i: number) =>
    Promise.all(parsed.stored.slice(i).map((s) => deleteFile(s.key).catch(() => {})));
  for (const [i, f] of parsed.stored.entries()) {
    let r: Awaited<ReturnType<typeof recordPortalUpload>>;
    try {
      r = await recordPortalUpload({
        identityId: identity.identityId,
        matterId: fields.matterId,
        requestId: fields.requestId,
        batchId: fields.batchId,
        storageKey: f.key,
        filename: f.name,
        contentType: f.contentType,
        size: f.size,
        note: fields.note,
      });
    } catch (err) {
      console.error("[portal-upload] completion failed", err);
      // The throw may come after this file's row was written (logging,
      // notify); keep its bytes then. The rest were never recorded.
      const recorded = await prisma.document
        .findFirst({ where: { fileUrl: f.key }, select: { id: true } })
        .catch(() => ({ id: "unknown" }));
      await removeFrom(recorded ? i + 1 : i);
      return json({ error: "Upload failed." }, 500);
    }
    if (!r.ok) {
      // recordPortalUpload removed this file; remove the unrecorded rest.
      await removeFrom(i + 1);
      return json({ error: r.error }, 403);
    }
    documents.push({ id: r.documentId, name: f.name, requestClosed: r.requestClosed });
  }
  return json({ documents });
}

type ParseOutcome = {
  stored: Stored[];
  result:
    Failure | { matterId: string; batchId: string; requestId: string | null; note: string | null };
};

function readFields(fields: Fields):
  | Failure
  | {
      matterId: string;
      batchId: string;
      requestId: string | null;
      note: string | null;
    } {
  const matterId = fields.matterId?.trim();
  const batchId = fields.batchId?.trim();
  if (!matterId || !batchId || !UUID.test(batchId)) {
    return { status: 400, error: "Invalid upload." };
  }
  const note = fields.note?.trim() || null;
  if (note && note.length > PORTAL_UPLOAD_NOTE_MAX) {
    return { status: 400, error: "That note is too long." };
  }
  return { matterId, batchId, requestId: fields.requestId?.trim() || null, note };
}

/** Stream-parse; validate the target once before the first byte is
 *  stored; check each file's type before storing it. Sequential parts,
 *  stop reading on the first failure (same shape as the staff route). */
async function parseAndStore(
  body: WebReadableStream<Uint8Array>,
  contentTypeHeader: string,
  identityId: string,
): Promise<ParseOutcome> {
  const stored: Stored[] = [];
  let bb: busboy.Busboy;
  try {
    bb = busboy({
      headers: { "content-type": contentTypeHeader },
      defParamCharset: "utf8",
      limits: { files: MAX_FILES_PER_BATCH, fields: 10, fieldSize: 4 * 1024 },
    });
  } catch {
    return { stored, result: { status: 400, error: "Malformed multipart body." } };
  }

  const source = Readable.fromWeb(body);
  const fields: Fields = {};
  let target: ReturnType<typeof readFields> | null = null;
  let failure: Failure | null = null;
  let chain: Promise<void> = Promise.resolve();

  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      void chain.then(resolve, resolve);
    };
    const fail = (f: Failure) => {
      if (!failure) failure = f;
    };

    bb.on("field", (name, value) => {
      if (name === "matterId" || name === "batchId" || name === "requestId" || name === "note") {
        fields[name] = value;
      }
    });

    bb.on("file", (name, stream, info) => {
      chain = chain
        .then(async () => {
          if (failure || name !== "files") {
            stream.resume();
            return;
          }
          const filename = capDocumentName((info.filename ?? "").trim());
          if (!filename) {
            stream.resume();
            return;
          }
          if (!target) {
            target = readFields(fields);
            if (!("error" in target)) {
              const t = await checkPortalUploadTarget({
                identityId,
                matterId: target.matterId,
                requestId: target.requestId,
                batchId: target.batchId,
              });
              if (!t.ok) target = { status: t.status, error: t.error };
            }
          }
          if ("error" in target) {
            fail(target);
            stream.resume();
            return;
          }
          const policy = checkPortalUpload(filename);
          if (!policy.ok) {
            fail({ status: 400, error: policy.error });
            stream.resume();
            return;
          }
          stream.on("error", () => {});
          try {
            const s = await storeStream(stream, filename, policy.maxBytes);
            if (s.size === 0) {
              await deleteFile(s.key).catch(() => {});
              fail({ status: 400, error: `"${filename}" is empty.` });
              return;
            }
            stored.push({
              key: s.key,
              size: s.size,
              name: filename,
              contentType: policy.contentType,
            });
          } catch (err) {
            fail(
              err instanceof FileTooLargeError
                ? { status: 413, error: `"${filename}" is too large.` }
                : { status: 500, error: "Upload failed." },
            );
          }
        })
        .catch(() => {
          fail({ status: 500, error: "Upload failed." });
          try {
            stream.resume();
          } catch {
            /* already destroyed */
          }
        })
        .then(() => {
          if (failure && !settled) {
            source.unpipe(bb);
            source.destroy();
            settle();
          }
        });
    });

    bb.on("filesLimit", () =>
      fail({ status: 400, error: `Too many files (max ${MAX_FILES_PER_BATCH} per upload).` }),
    );
    bb.on("error", () => {
      fail({ status: 400, error: "Malformed multipart body." });
      settle();
    });
    bb.on("close", settle);
    source.on("error", () => {
      source.unpipe(bb);
      bb.destroy();
      settle();
    });
    source.pipe(bb);
  });

  if (!failure && stored.length === 0) failure = { status: 400, error: "No files in the upload." };
  if (failure) return { stored, result: failure };
  return { stored, result: target as unknown as Exclude<ReturnType<typeof readFields>, Failure> };
}
