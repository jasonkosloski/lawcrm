/**
 * GET /api/documents/[id]/download
 *
 * Auth-gated file download. Verifies the session (and that the user
 * belongs to a firm), looks the document up by id, then streams the
 * bytes from the storage adapter.
 *
 * ACCESS MODEL (be precise — do not assume more than this): any
 * authenticated firm user can read any document by id. There is NO
 * firm scoping (Matter has no firmId; single-tenant today) and NO
 * matter-team visibility check (MatterTeamMember is organizational,
 * not an access gate — the whole app reads firm-wide). Both are
 * tracked as separate phases (multi-tenancy; ethical walls) and must
 * be applied consistently to the viewer, documents tab, search and
 * this route together, not here alone.
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
 *   - Blob key (full https:// URL into the PRIVATE store): 302 to a
 *     short-lived presigned URL for that one file, minted only after
 *     the session check (ADR-018). Vercel's CDN handles Range/seeking
 *     natively, so GB media never transits our serverless functions.
 *     The stored URL alone fetches nothing. Content is served from
 *     blob.vercel-storage.com — an isolated origin — which is why the
 *     inline-XSS allowlist below is a UX signal there but MUST stay
 *     for the local path (ADR-015).
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  isBlobKey,
  openReadStream,
  signedBlobUrl,
  statFile,
} from "@/lib/file-storage";
import { isInlineSafeType } from "@/lib/inline-safe-types";
import { resolveRangeHeader } from "./range";
import { Readable } from "node:stream";

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
// The set itself (and the full XSS reasoning: uploader-controlled
// `Document.contentType`, deliberately-absent HTML/SVG) lives in
// `src/lib/inline-safe-types.ts` — imported above — SHARED with the
// email-attachment download route so the two allowlists can never
// drift.

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
  // Guard only: the user must belong to a firm. The firmId is NOT
  // used to scope the document lookup below (see ACCESS MODEL in the
  // header).
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { firmId: true },
  });
  if (!user?.firmId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const doc = await prisma.document.findFirst({
    // TODO (multi-tenant): once Matter carries a firmId, add
    // `matter: { firmId: user.firmId }` here.
    where: { id },
    select: {
      id: true,
      name: true,
      contentType: true,
      fileUrl: true,
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
  // Bare-media-type comparison lives in the shared predicate — a
  // stored "text/html; charset=utf-8" must not slip past.
  const inlineSafe = isInlineSafeType(contentType);

  // ── Blob-stored document → 302 to a presigned URL ──────────────
  // Range/seeking is the CDN's job from here; we never proxy the
  // bytes. Disposition: @vercel/blob can't set a custom
  // Content-Disposition at upload; the lever is the CDN's
  // `download=1` param. Allowlisted types sign for inline viewing,
  // everything else for attachment. Media gets the long signed-URL
  // lifetime so seeking through a long recording keeps working
  // (ADR-018). The redirect must never be cached — it's the auth
  // boundary.
  if (isBlobKey(doc.fileUrl)) {
    const target = await signedBlobUrl(doc.fileUrl, {
      download: !inlineSafe,
      media: /^(audio|video)\//i.test(contentType),
    });
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

  // Web-streams interop. `Readable.toWeb` is pull-based, so a stalled
  // client applies backpressure to the disk read (a hand-rolled 'data'
  // listener buffers the whole range in memory) and cancelling the
  // response (a seek aborting the previous range request) destroys the
  // fs stream instead of leaking its descriptor.
  // Ranged reads slice at the fs layer (createReadStream start/end,
  // both inclusive) — a seek never reads the skipped bytes.
  const nodeStream = openReadStream(
    doc.fileUrl,
    partial ? { start: range.start, end: range.end } : undefined
  ) as Readable;
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

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
