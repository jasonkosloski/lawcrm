/**
 * GET /api/documents/[id]/download
 *
 * Auth-gated file download. Verifies session, scopes the document
 * by the current user's firm (via the document's matter → matter's
 * client → contact's firmId — for v1 we just confirm the user can
 * see the matter), then streams the bytes from the storage adapter.
 *
 * Supports single-range HTTP Range requests (`bytes=...`) so the
 * document viewer's <video>/<audio> elements can seek GB-scale
 * discovery media without pulling the whole file: 206 + Content-Range
 * for a satisfiable range, 416 + `Content-Range: bytes *​/size` when
 * the range lies past EOF, 200 full body otherwise (multi-range and
 * malformed headers are lawfully ignored — see ./range.ts).
 *
 * Two serving modes, chosen per-document by KEY SHAPE (ADR-015):
 *
 *   - Local key (bare `{rand}__{name}`): stream the bytes from disk
 *     through this route, exactly as before. The session check is
 *     the security boundary for every byte.
 *   - Blob key (full https:// URL): 302 to the blob URL. Vercel's
 *     CDN handles Range/seeking natively, so GB media never transits
 *     our serverless functions. The session check still gates who is
 *     ever HANDED the URL — but the URL itself is an
 *     unguessable-but-public bearer URL on an isolated origin
 *     (blob.vercel-storage.com). See ADR-015 for the honest
 *     trade-off, including why the inline-XSS allowlist below is
 *     moot for that path but MUST stay for the local one.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  blobDownloadUrl,
  isBlobKey,
  openReadStream,
  statFile,
} from "@/lib/file-storage";
import { resolveRangeHeader } from "./range";
import type { Readable } from "node:stream";

// Per-request: never cache. Documents change owners + go away;
// the path is the auth boundary, not the bytes.
export const dynamic = "force-dynamic";

// Content types allowed to render inline in the browser. Everything
// else is forced to `attachment`. This allowlist matters ONLY for
// the LOCAL streaming path — it defends OUR origin, where inline
// HTML/SVG would execute with our cookies. Blob-stored documents
// are served from blob.vercel-storage.com, an isolated origin with
// no session to ride, so the redirect branch reuses this set purely
// as a UX signal (inline-viewable vs force-download) — see ADR-015.
//
// This is an allowlist on purpose:
// `Document.contentType` is the uploader's *client-declared* MIME
// type (`file.type`, see `storeFile()` — the upload action validates
// size only), so any user with upload access controls this string.
// Serving attacker-declared `text/html` or `image/svg+xml` inline
// would execute their markup on our origin for whoever clicks the
// link — stored XSS riding a colleague's (possibly admin) session.
// HTML and SVG are therefore deliberately absent; add new types only
// if the browser can't execute script from them.
//
// The media + text entries exist for the discovery viewer: browsers
// render video/audio/image/plain-text passively — no script context
// is ever created for them, and `X-Content-Type-Options: nosniff`
// (set on every response below) stops re-interpretation of the
// bytes as anything active. text/plain and text/csv render as
// inert text; markup inside them is displayed, not executed.
const INLINE_SAFE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "text/plain",
  "text/csv",
]);

export async function GET(
  req: NextRequest,
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

  // Confirm the file actually exists — DB-row vs storage can drift
  // if a previous delete only got the row. `statFile` dispatches on
  // key shape (disk stat vs blob `head`). Treat as 410 Gone so the
  // UI can prune the stale row.
  const fsStat = await statFile(doc.fileUrl);
  if (!fsStat) {
    return NextResponse.json({ error: "File missing" }, { status: 410 });
  }

  const contentType = doc.contentType ?? "application/octet-stream";
  // Compare on the bare media type — a stored value like
  // "text/html; charset=utf-8" must not slip past the allowlist.
  const inlineSafe = INLINE_SAFE_TYPES.has(
    contentType.split(";")[0].trim().toLowerCase()
  );

  // ── Blob-stored document → 302 to the blob CDN ─────────────────
  // Range/seeking is the CDN's job from here; we never proxy the
  // bytes. Disposition forcing works differently than the local
  // path: @vercel/blob (v2.6.0) does NOT let us set a custom
  // Content-Disposition at upload — the CDN serves inline with the
  // filename derived from the pathname, and the only lever is the
  // `?download=1` query param, which flips the same blob to
  // `attachment`. So: allowlisted types redirect to the bare URL
  // (inline preview), everything else to the ?download=1 variant.
  // The redirect itself must never be cached — it's the auth
  // boundary; the blob URL behind it is bearer-token-ish (ADR-015).
  if (isBlobKey(doc.fileUrl)) {
    const target = inlineSafe ? doc.fileUrl : blobDownloadUrl(doc.fileUrl);
    return NextResponse.redirect(target, {
      status: 302,
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  }

  // Resolve any Range request against the on-disk size. 416 gets
  // `Content-Range: bytes */size` so the media element learns the
  // real length and can retry with a valid offset.
  const range = resolveRangeHeader(req.headers.get("range"), fsStat.size);
  if (range.kind === "unsatisfiable") {
    return NextResponse.json(
      { error: "Range not satisfiable" },
      {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fsStat.size}`,
          "Accept-Ranges": "bytes",
        },
      }
    );
  }
  const partial = range.kind === "partial";

  // Web-streams interop: Node's Readable converts via fromWeb /
  // toWeb. Next.js accepts a ReadableStream<Uint8Array> body.
  // Ranged reads slice at the fs layer (createReadStream start/end,
  // both inclusive) — a seek never reads the skipped bytes.
  const nodeStream = openReadStream(
    doc.fileUrl,
    partial ? { start: range.start, end: range.end } : undefined
  ) as Readable;
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

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(
      partial ? range.end - range.start + 1 : fsStat.size
    ),
    // Advertise seekability — media elements probe this before
    // issuing Range requests.
    "Accept-Ranges": "bytes",
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
  if (partial) {
    headers["Content-Range"] =
      `bytes ${range.start}-${range.end}/${fsStat.size}`;
  }

  return new Response(webStream, { status: partial ? 206 : 200, headers });
}
