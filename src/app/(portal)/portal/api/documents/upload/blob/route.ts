/**
 * POST /api/documents/upload/blob on the PORTAL host (internally
 * /portal/api/documents/upload/blob via the proxy rewrite; /portal/* 404s on
 * the staff host). Token + completion endpoint for client-direct uploads;
 * all rules live in ./portal-blob-upload.ts. JSON only, never redirects.
 */

import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { PortalUploadError, onBeforeGenerateToken, onUploadCompleted } from "./portal-blob-upload";

export const dynamic = "force-dynamic";

const GENERIC_UPLOAD_ERROR = "Upload handling failed.";

export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
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
    // Only PortalUploadError text is user-safe; anything else is a 500
    // (which also makes Vercel retry a failed completion). Never log the
    // payload: it carries file names.
    const known = err instanceof PortalUploadError;
    const status = known ? err.status : 500;
    console.error("[portal-blob-upload] request failed", {
      event: body?.type,
      status,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: known ? err.message : GENERIC_UPLOAD_ERROR }, { status });
  }
}
