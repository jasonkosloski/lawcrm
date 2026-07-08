/**
 * GET /api/email-attachments/[id]/download
 *
 * Auth-gated email-attachment download — the byte-transfer sibling
 * of /api/documents/[id]/download (a sanctioned route-handler
 * exception: server actions can't stream file responses). Mirrors
 * that route's discipline exactly: session gate, inline allowlist
 * (shared `src/lib/inline-safe-types.ts` — EmailAttachment
 * .contentType is SENDER-declared, i.e. attacker-controlled, so the
 * same stored-XSS reasoning applies verbatim), nosniff on every
 * response, CSP sandbox on forced attachments, single-range 206
 * support, blob keys 302 to the CDN.
 *
 * Scoping: attachment → message → thread → account, and the account
 * must belong to the CURRENT user. This deliberately matches the
 * inbox read model — `getThreadById` scopes every thread read by
 * `account: { userId }` (threads are mailbox-personal reads today,
 * NOT firm-wide), so serving another member's attachment bytes here
 * would leak past what the UI lets them see. Non-owned ids 404
 * (existence isn't disclosed), same shape as a missing row.
 *
 * Bytes on demand (Email v1.1): sync stores metadata only, parking
 * the Gmail attachment id as `fileUrl: "gmail:<id>"`. First download
 * fetches the bytes from Gmail and caches them to storage via the
 * shared `ensureAttachmentBytes` helper (fileUrl flips to a real
 * storage key exactly once); every later download serves the cached
 * copy with zero Gmail calls. If the mailbox has been disconnected
 * BEFORE the bytes were ever cached, they're unreachable → 409 with
 * a reconnect message ("no_bytes" rows — sync captured no Gmail id —
 * are a permanent 404).
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
import { isInlineSafeType } from "@/lib/inline-safe-types";
import {
  AttachmentBytesError,
  ensureAttachmentBytes,
} from "@/lib/email-attachments";
import { resolveRangeHeader } from "@/app/api/documents/[id]/download/range";
import type { Readable } from "node:stream";

// Never cache — the session check is the auth boundary, and the
// first hit mutates (parks → cached fileUrl).
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // Owner-scoped in the WHERE clause — the read-model match (see
  // module docstring). A non-owned or unknown id is the same 404.
  const attachment = await prisma.emailAttachment.findFirst({
    where: {
      id,
      message: { thread: { account: { userId: session.user.id } } },
    },
    select: { id: true, filename: true, contentType: true },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let key: string;
  try {
    ({ key } = await ensureAttachmentBytes(attachment.id));
  } catch (err) {
    if (err instanceof AttachmentBytesError) {
      switch (err.code) {
        case "no_bytes":
          return NextResponse.json({ error: err.message }, { status: 404 });
        case "disconnected":
          // Uncached + disconnected: the bytes exist only at Google
          // and we can no longer ask. 409 (account state conflicts
          // with the request), message tells the owner how to fix it.
          return NextResponse.json({ error: err.message }, { status: 409 });
        case "fetch_failed":
          return NextResponse.json({ error: err.message }, { status: 502 });
      }
    }
    throw err;
  }

  // DB row vs storage drift (file pruned out-of-band) → 410 Gone,
  // matching the documents route.
  const fsStat = await statFile(key);
  if (!fsStat) {
    return NextResponse.json({ error: "File missing" }, { status: 410 });
  }

  const contentType = attachment.contentType ?? "application/octet-stream";
  const inlineSafe = isInlineSafeType(contentType);

  // Blob-cached attachment → 302 to the CDN (never proxied); the
  // redirect is the auth boundary and must not be cached. Same
  // inline-vs-?download=1 split as documents (ADR-015).
  if (isBlobKey(key)) {
    const target = inlineSafe ? key : blobDownloadUrl(key);
    return NextResponse.redirect(target, {
      status: 302,
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  }

  // Single-range support comes free from the shared resolver + the
  // local driver's ranged reads — same contract as documents.
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

  const nodeStream = openReadStream(
    key,
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
    "Accept-Ranges": "bytes",
    // Without nosniff, browsers may sniff even a benign declared
    // type into something active (e.g. octet-stream → HTML).
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${inlineSafe ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    "Cache-Control": "private, no-cache, no-store, must-revalidate",
  };
  if (!inlineSafe) {
    // Defense in depth — identical rationale to the documents route:
    // a sandboxed document gets an opaque origin, no session to ride.
    headers["Content-Security-Policy"] = "sandbox";
  }
  if (partial) {
    headers["Content-Range"] =
      `bytes ${range.start}-${range.end}/${fsStat.size}`;
  }

  return new Response(webStream, { status: partial ? 206 : 200, headers });
}
