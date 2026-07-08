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
    // UploadTokenError carries a real status (401/403/404/400); the
    // @vercel/blob client surfaces the message to the uploader. A
    // failed onUploadCompleted also lands here — non-2xx makes
    // Vercel retry the callback.
    const status = err instanceof UploadTokenError ? err.status : 400;
    const message =
      err instanceof Error ? err.message : "Upload handling failed.";
    return NextResponse.json({ error: message }, { status });
  }
}
