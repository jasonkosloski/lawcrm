/**
 * Server-side document preview pipelines for the matter document
 * viewer (`/matters/[id]/documents/[documentId]`).
 *
 * Two conversions happen here rather than in the browser:
 *
 *   1. DOCX → sanitized HTML via mammoth — since the docx-preview
 *      upgrade this is the viewer's FALLBACK, not its primary
 *      renderer. The primary render is client-side docx-preview
 *      (layout-faithful — see
 *      `src/components/documents-viewer/docx-preview-renderer.tsx`);
 *      the page still precomputes this conversion on every docx view
 *      and passes it down so the swap on a docx-preview failure is
 *      instant (mammoth is also the more forgiving parser, so it
 *      often still yields text for damaged files). The bytes live
 *      behind the storage adapter (`Document.fileUrl` is a storage
 *      key, not a URL), and mammoth's output is attacker-influenced
 *      markup — whoever uploaded the .docx controls it — so the HTML
 *      is passed through `sanitizeDocumentHtml` before the page ever
 *      renders it.
 *   2. text/csv preview — a capped read (1 MB) so a multi-GB log
 *      dump can't balloon the server render.
 *
 * Every failure path returns a value (never throws) so the page can
 * render a graceful error card instead of a 500.
 *
 * Server-only by usage (reads the local filesystem through the
 * storage adapter) — not via the `server-only` package, which throws
 * outside a react-server condition and would break unit tests, same
 * trade-off as `src/lib/file-storage.ts`.
 */

import mammoth from "mammoth";
import { openReadStream, statFile } from "@/lib/file-storage";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";

/** Ceiling for buffering a .docx into memory for conversion. Matches
 *  the 25 MB form-upload cap — a Word doc bigger than this is almost
 *  certainly image-stuffed and the user is better served downloading. */
export const DOCX_MAX_BYTES = 25 * 1024 * 1024;

/** Text/CSV previews are capped here; past it we truncate and say so. */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

export type DocxPreviewResult =
  | { ok: true; html: string }
  | { ok: false; reason: string };

/** Buffer a stored file fully into memory, bounded by `maxBytes`
 *  (bytes past the cap are never read — the fs read is ranged). */
async function readStoredBytes(
  key: string,
  maxBytes: number
): Promise<{ buffer: Buffer; truncated: boolean } | null> {
  const stat = await statFile(key);
  if (!stat) return null;
  const truncated = stat.size > maxBytes;
  const stream = openReadStream(
    key,
    truncated ? { start: 0, end: maxBytes - 1 } : undefined
  );
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

/**
 * Convert a stored .docx (by storage key) to sanitized HTML.
 *
 * Failure modes (all returned, never thrown):
 *  - file missing on disk (DB/fs drift) → reason
 *  - file over `DOCX_MAX_BYTES` → reason (no partial conversion —
 *    a truncated zip is garbage to mammoth anyway)
 *  - mammoth can't parse (corrupt, or a mislabeled legacy .doc —
 *    mammoth only reads OOXML) → reason
 *  - converts to nothing visible → reason (empty preview is worse
 *    than an honest card)
 */
export async function renderStoredDocxToSafeHtml(
  key: string
): Promise<DocxPreviewResult> {
  // Size gate before any read — a truncated zip is garbage to
  // mammoth, so there is no point buffering the capped prefix.
  let stat: Awaited<ReturnType<typeof statFile>>;
  try {
    stat = await statFile(key);
  } catch {
    return { ok: false, reason: "The file could not be read from storage." };
  }
  if (!stat) {
    return { ok: false, reason: "The file is missing from storage." };
  }
  if (stat.size > DOCX_MAX_BYTES) {
    return {
      ok: false,
      reason: `This Word document is larger than ${Math.round(DOCX_MAX_BYTES / (1024 * 1024))} MB — download it to view.`,
    };
  }

  let read: Awaited<ReturnType<typeof readStoredBytes>>;
  try {
    read = await readStoredBytes(key, DOCX_MAX_BYTES);
  } catch {
    return { ok: false, reason: "The file could not be read from storage." };
  }
  if (!read) {
    return { ok: false, reason: "The file is missing from storage." };
  }

  let rawHtml: string;
  try {
    const result = await mammoth.convertToHtml({ buffer: read.buffer });
    rawHtml = result.value;
  } catch {
    return {
      ok: false,
      reason:
        "The document could not be converted. It may be corrupt, or an older .doc file saved with a .docx name.",
    };
  }

  const html = sanitizeDocumentHtml(rawHtml);
  if (html.length === 0) {
    return {
      ok: false,
      reason: "The document converted to an empty preview.",
    };
  }
  return { ok: true, html };
}

export type TextPreviewResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: string };

/** Read a stored text file for preview, capped at
 *  `TEXT_PREVIEW_MAX_BYTES`. The caller renders `text` inside a
 *  React-escaped `<pre>`/table — no sanitization needed because the
 *  content is never interpreted as HTML. */
export async function readStoredTextPreview(
  key: string
): Promise<TextPreviewResult> {
  let read: Awaited<ReturnType<typeof readStoredBytes>>;
  try {
    read = await readStoredBytes(key, TEXT_PREVIEW_MAX_BYTES);
  } catch {
    return { ok: false, reason: "The file could not be read from storage." };
  }
  if (!read) {
    return { ok: false, reason: "The file is missing from storage." };
  }
  // Lossy UTF-8 decode is fine for a preview — a stray replacement
  // character at a truncation boundary beats failing the render.
  return {
    ok: true,
    text: read.buffer.toString("utf-8"),
    truncated: read.truncated,
  };
}

/**
 * Parse CSV text into rows for a table preview — RFC 4180 flavor
 * (quoted cells, doubled quotes, CRLF or LF row breaks).
 *
 * Returns `null` when the text doesn't parse *cleanly*, and the
 * caller falls back to the plain `<pre>` view:
 *  - unclosed quote at EOF
 *  - a bare quote in the middle of an unquoted cell
 *  - ragged rows (not every row has the header's column count)
 *  - only one column overall (a table adds nothing over the raw text)
 *
 * Pure function — unit-tested directly.
 */
export function parseCsvPreview(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  /** True once the current cell started with a quote — a closing
   *  quote must then be followed by a separator or EOL. */
  let cellWasQuoted = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
    cellWasQuoted = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (cell.length > 0 || cellWasQuoted) return null; // quote mid-cell
      inQuotes = true;
      cellWasQuoted = true;
      i += 1;
      continue;
    }
    if (cellWasQuoted && ch !== "," && ch !== "\n" && ch !== "\r") {
      return null; // trailing garbage after a closing quote
    }
    if (ch === ",") {
      endCell();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (inQuotes) return null; // unclosed quote at EOF
  // Flush the final row unless the text ended with a newline (in
  // which case endRow already ran and cell/row are both empty).
  if (cell.length > 0 || cellWasQuoted || row.length > 0) endRow();

  if (rows.length === 0) return null;
  const width = rows[0].length;
  if (width < 2) return null; // single column — pre view is better
  if (rows.some((r) => r.length !== width)) return null; // ragged
  return rows;
}
