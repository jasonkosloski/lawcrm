/**
 * GET /api/documents/[id]/download on the PORTAL host (internally
 * /portal/api/documents/[id]/download).
 *
 * `canPortalDownload` is the single gate (live access, portal on, not
 * archived, effectively shared or uploaded by a client of the same matter).
 * Anything it rejects, a missing session, or a staff-host request is a bare
 * 404 with no body detail and no log. Responses are ALWAYS attachments (the
 * client never renders firm-held bytes on our origin) and never cached.
 *
 * Blob keys 302 to a short-lived signed download URL (ADR-018); local keys
 * stream from disk. Range requests are not supported.
 */

import { Readable } from "node:stream";
import { getPortalIdentity } from "@/lib/portal-access";
import { canPortalDownload } from "@/lib/portal/document-visibility.server";
import {
  isBlobKey,
  openReadStream,
  signedBlobUrl,
} from "@/lib/file-storage";

export const dynamic = "force-dynamic";

const NO_STORE = "private, no-cache, no-store, must-revalidate";

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const identity = await getPortalIdentity();
  if (!identity) return notFound();

  const { id } = await ctx.params;
  const doc = await canPortalDownload(identity.identityId, id);
  if (!doc || !doc.fileUrl) return notFound();

  if (isBlobKey(doc.fileUrl)) {
    const target = await signedBlobUrl(doc.fileUrl, {
      download: true,
      media: false,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: target, "Cache-Control": NO_STORE },
    });
  }

  let nodeStream: Readable;
  try {
    nodeStream = openReadStream(doc.fileUrl) as Readable;
  } catch {
    return notFound();
  }
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": doc.contentType ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "Content-Security-Policy": "sandbox",
      "Cache-Control": NO_STORE,
    },
  });
}
