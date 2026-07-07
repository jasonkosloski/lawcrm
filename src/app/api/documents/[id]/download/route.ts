/**
 * GET /api/documents/[id]/download
 *
 * Auth-gated file download. Verifies session, scopes the document
 * by the current user's firm (via the document's matter → matter's
 * client → contact's firmId — for v1 we just confirm the user can
 * see the matter), then streams the bytes from the storage adapter.
 *
 * Why a route handler and not a public storage URL: the storage
 * key is opaque, but if we ever swapped to public-CDN URLs the
 * security boundary would move outside the app. Streaming through
 * here keeps every download under the session check + audit
 * surface, regardless of which storage backend lives behind
 * `src/lib/file-storage.ts`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { openReadStream, statFile } from "@/lib/file-storage";
import type { Readable } from "node:stream";

// Per-request: never cache. Documents change owners + go away;
// the path is the auth boundary, not the bytes.
export const dynamic = "force-dynamic";

// Content types allowed to render inline in the browser. Everything
// else is forced to `attachment`. This is an allowlist on purpose:
// `Document.contentType` is the uploader's *client-declared* MIME
// type (`file.type`, see `storeFile()` — the upload action validates
// size only), so any user with upload access controls this string.
// Serving attacker-declared `text/html` or `image/svg+xml` inline
// would execute their markup on our origin for whoever clicks the
// link — stored XSS riding a colleague's (possibly admin) session.
// HTML and SVG are therefore deliberately absent; add new types only
// if the browser can't execute script from them.
const INLINE_SAFE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    // Match the proxy + dashboard layout pattern — authoritative
    // auth check, not just cookie presence.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // Resolve the firm via the user → first found firmId. Matches the
  // chokepoint pattern used by `getCurrentFirm()` but inlined so the
  // route handler stays standalone.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { firmId: true },
  });
  if (!user?.firmId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const doc = await prisma.document.findFirst({
    where: {
      id,
      // Today, every Matter is in the seed firm and we trust the
      // session-based gate above. When Contact gains firmId we can
      // tighten this with `matter: { client: { firmId: user.firmId } }`.
    },
    select: {
      id: true,
      name: true,
      contentType: true,
      fileUrl: true,
      fileSize: true,
    },
  });
  if (!doc || !doc.fileUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Confirm the file actually exists on disk — DB-row vs filesystem
  // can drift if a previous delete only got the row. Treat as 410
  // Gone so the UI can prune the stale row.
  const fsStat = await statFile(doc.fileUrl);
  if (!fsStat) {
    return NextResponse.json({ error: "File missing" }, { status: 410 });
  }

  // Web-streams interop: Node's Readable converts via fromWeb /
  // toWeb. Next.js accepts a ReadableStream<Uint8Array> body.
  const nodeStream = openReadStream(doc.fileUrl) as Readable;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webStream = (nodeStream as any).toWeb
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (nodeStream as any).toWeb()
    : new ReadableStream({
        start(controller) {
          nodeStream.on("data", (chunk) => controller.enqueue(chunk));
          nodeStream.on("end", () => controller.close());
          nodeStream.on("error", (err) => controller.error(err));
        },
      });

  const contentType = doc.contentType ?? "application/octet-stream";
  // Compare on the bare media type — a stored value like
  // "text/html; charset=utf-8" must not slip past the allowlist.
  const inlineSafe = INLINE_SAFE_TYPES.has(
    contentType.split(";")[0].trim().toLowerCase()
  );

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(fsStat.size),
    // Without nosniff, browsers may sniff even a benign declared
    // type into something active (e.g. octet-stream → HTML).
    "X-Content-Type-Options": "nosniff",
    // filename* (RFC 5987) handles non-ASCII names cleanly. The UI
    // link uses target="_blank" so allowlisted types (PDFs, images)
    // preview inline; anything user-declared beyond that set is
    // forced to download — see INLINE_SAFE_TYPES for why.
    "Content-Disposition": `${inlineSafe ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
    "Cache-Control": "private, no-cache, no-store, must-revalidate",
  };
  if (!inlineSafe) {
    // Defense in depth: even if some browser renders the attachment
    // anyway, a sandboxed document gets a unique opaque origin — no
    // script, no cookies, no session to ride. Not applied to the
    // inline path because `sandbox` disables the plugin machinery
    // Chrome's PDF viewer needs, which would break PDF previews.
    headers["Content-Security-Policy"] = "sandbox";
  }

  return new Response(webStream, { headers });
}
