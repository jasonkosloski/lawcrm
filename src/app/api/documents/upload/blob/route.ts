/**
 * POST /api/documents/upload/blob
 *
 * Token + completion endpoint for CLIENT-DIRECT Vercel Blob uploads
 * (`upload()` from @vercel/blob/client). Two event types arrive on
 * this one route and `handleUpload` dispatches them:
 *
 *   - blob.generate-client-token  → onBeforeGenerateToken (all auth
 *     + validation lives there — see ./blob-upload.ts)
 *   - blob.upload-completed       → onUploadCompleted (Document row
 *     + audit + revalidate; caller is VERCEL, not a user — the
 *     callback is signature-verified by handleUpload)
 *
 * This exists because prod serverless request bodies cap at ~4.5MB
 * — the streaming route (../route.ts) can't receive GB media on
 * Vercel. Conversely, the completion callback can't reach localhost
 * (Vercel calls back over the public internet), which is exactly
 * why the streaming route is kept for local dev. The documents-tab
 * uploader picks its path from the active storage driver.
 */

import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import {
  UploadTokenError,
  onBeforeGenerateToken,
  onUploadCompleted,
} from "./blob-upload";

const GENERIC_UPLOAD_ERROR = "Upload handling failed.";

// Never cache, always run per-request — this is a mutation.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body." },
      { status: 400 }
    );
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken,
      onUploadCompleted,
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    // UploadTokenError messages are written to be user-safe and carry
    // a real status (401/403/404/400) - but the @vercel/blob client
    // never shows them to the uploader (see the note below). ANY OTHER error (Prisma, SDK,
    // zod, ...) is internal: its text is logged server-side but never
    // echoed to the caller (browser or Vercel's callback), and it maps
    // to 500 - a failed onUploadCompleted still lands here, and any
    // non-2xx makes Vercel retry the callback.
    const known = err instanceof UploadTokenError;
    const status = known ? err.status : 500;
    const message = known ? err.message : GENERIC_UPLOAD_ERROR;
    // The @vercel/blob client discards this body and shows only
    // "Failed to retrieve the client token", so the server log is
    // the one place the real reason surfaces. Event type + status +
    // the REAL message only - never the payload (it carries file names).
    console.error("[blob-upload] request failed", {
      event: body?.type,
      status,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: message }, { status });
  }
}
