/**
 * Server-side previews for Excel workbooks and email files, the same
 * pattern as the docx/text previews in `document-preview.ts`: read the
 * stored bytes (bounded), parse, and hand the viewer plain data. Every
 * failure is a `{ ok: false, reason }` the page shows as a card, never
 * a 500.
 *
 *   .xlsx  → read-excel-file: each sheet as rows of display strings.
 *            Values only (no formatting or formulas), capped per sheet
 *            so a 100k-row export can't blow up the page.
 *   .eml   → postal-mime (RFC 822 / MIME)
 *   .msg   → @kenjiuno/msgreader (Outlook)
 *            Both become one EmailPreview: headers, a body sanitized
 *            with the hostile-mail profile (`sanitizeEmailHtml`, which
 *            also blocks remote tracking images), and the attachment
 *            list. Embedded (cid:) images in .eml bodies render inline
 *            as data: URIs. Attachments are listed, not opened.
 *
 * Productions from opposing parties are untrusted: zip-based files go
 * through `checkZipBounds` before anything inflates them.
 */

import readExcelFile from "read-excel-file/node";
import PostalMime, { type Address } from "postal-mime";
import MsgReader from "@kenjiuno/msgreader";
import { statFile } from "@/lib/file-storage";
import { checkZipBounds, readStoredBytes } from "@/lib/document-preview";
import { sanitizeEmailHtml } from "@/lib/sanitize-html";

export const SPREADSHEET_MAX_BYTES = 10 * 1024 * 1024;
export const SPREADSHEET_MAX_SHEETS = 25;
export const SPREADSHEET_MAX_ROWS = 2_000;
export const SPREADSHEET_MAX_COLS = 60;
export const EMAIL_MAX_BYTES = 25 * 1024 * 1024;

export type PreviewFailure = { ok: false; reason: string };

export type SpreadsheetSheet = {
  name: string;
  rows: string[][];
  /** Rows/columns cut by the caps (shown as a notice). */
  hiddenRows: number;
  hiddenCols: number;
};

export type SpreadsheetPreviewResult =
  { ok: true; sheets: SpreadsheetSheet[]; hiddenSheets: number } | PreviewFailure;

export type EmailPreview = {
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  /** ISO instant, or null when the file has no usable date. */
  date: string | null;
  /** Sanitized HTML body, when the message has one. */
  html: string | null;
  text: string;
  attachments: { name: string; size: number | null }[];
};

export type EmailPreviewResult = { ok: true; email: EmailPreview } | PreviewFailure;

const READ_FAILED: PreviewFailure = {
  ok: false,
  reason: "The file could not be read from storage.",
};
const MISSING: PreviewFailure = { ok: false, reason: "The file is missing from storage." };

async function readWhole(
  key: string,
  maxBytes: number,
  label: string,
): Promise<{ ok: true; buffer: Buffer } | PreviewFailure> {
  let stat: Awaited<ReturnType<typeof statFile>>;
  try {
    stat = await statFile(key);
  } catch {
    return READ_FAILED;
  }
  if (!stat) return MISSING;
  if (stat.size > maxBytes) {
    return {
      ok: false,
      reason: `This ${label} is larger than ${Math.round(maxBytes / (1024 * 1024))} MB — download it to view.`,
    };
  }
  try {
    const read = await readStoredBytes(key, maxBytes, stat);
    return read ? { ok: true, buffer: read.buffer } : MISSING;
  } catch {
    return READ_FAILED;
  }
}

// ── Spreadsheets ──────────────────────────────────────────────────────

/** One cell as it should read on screen. Dates come back from the
 *  parser as UTC instants; a whole-day value shows as YYYY-MM-DD. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/** Trim a sheet to the caps and drop trailing empty rows/columns. */
export function shapeSheet(name: string, data: unknown[][]): SpreadsheetSheet {
  const rows = data.map((r) => r.map(formatCell));
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  let width = 0;
  for (const r of rows) {
    for (let i = r.length - 1; i >= width; i--) {
      if (r[i] !== "") {
        width = i + 1;
        break;
      }
    }
  }
  const shownCols = Math.min(width, SPREADSHEET_MAX_COLS);
  const shown = rows.slice(0, SPREADSHEET_MAX_ROWS).map((r) => {
    const row = r.slice(0, shownCols);
    while (row.length < shownCols) row.push("");
    return row;
  });
  return {
    name,
    rows: shown,
    hiddenRows: Math.max(0, rows.length - SPREADSHEET_MAX_ROWS),
    hiddenCols: Math.max(0, width - SPREADSHEET_MAX_COLS),
  };
}

export async function renderStoredSpreadsheet(key: string): Promise<SpreadsheetPreviewResult> {
  const read = await readWhole(key, SPREADSHEET_MAX_BYTES, "spreadsheet");
  if (!read.ok) return read;
  const bounds = checkZipBounds(read.buffer);
  if (!bounds.ok) {
    return {
      ok: false,
      reason: "This spreadsheet expands to an unusually large size — download it to view.",
    };
  }
  let parsed: { sheet: string; data: unknown[][] }[];
  try {
    parsed = (await readExcelFile(read.buffer)) as { sheet: string; data: unknown[][] }[];
  } catch {
    return {
      ok: false,
      reason:
        "The spreadsheet could not be read. It may be corrupt, password-protected, or an older .xls file.",
    };
  }
  const sheets = parsed.slice(0, SPREADSHEET_MAX_SHEETS).map((s) => shapeSheet(s.sheet, s.data));
  if (sheets.every((s) => s.rows.length === 0)) {
    return { ok: false, reason: "The spreadsheet is empty." };
  }
  return { ok: true, sheets, hiddenSheets: Math.max(0, parsed.length - SPREADSHEET_MAX_SHEETS) };
}

// ── Email ─────────────────────────────────────────────────────────────

function mailbox(name: string | undefined, address: string | undefined): string {
  const n = name?.trim();
  const a = address?.trim();
  if (n && a && n !== a) return `${n} <${a}>`;
  return n || a || "";
}

/** postal-mime addresses (groups flattened) → display strings. */
function addressList(list: Address[] | Address | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const a of Array.isArray(list) ? list : [list]) {
    if ("group" in a && a.group) out.push(...a.group.map((m) => mailbox(m.name, m.address)));
    else out.push(mailbox(a.name, a.address));
  }
  return out.filter(Boolean);
}

function isoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Sanitized HTML body, or null when there's nothing left of it. */
function safeHtml(html: string | undefined): string | null {
  if (!html) return null;
  const clean = sanitizeEmailHtml(html);
  return clean.trim() === "" ? null : clean;
}

function byteSize(content: ArrayBuffer | string | Uint8Array | undefined): number | null {
  if (content === undefined) return null;
  if (typeof content === "string") return content.length;
  return content.byteLength;
}

/** Raster types an embedded (cid:) image may be inlined as. No SVG:
 *  it's a document format, not just pixels. */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** Total bytes of embedded images inlined into one body. */
export const EMAIL_INLINE_IMAGES_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Point `cid:` image references (logos, signatures, pasted pictures
 * that travel inside the message) at data: URIs built from their MIME
 * parts, so they render. They're part of the file, so there's no
 * network fetch or tracking involved (remote images stay blocked by
 * the sanitizer). Returns the rewritten HTML and the content ids used,
 * so those parts aren't also listed as attachments.
 */
export function inlineCidImages(
  html: string,
  parts: { contentId?: string; mimeType: string; content: ArrayBuffer | Uint8Array | string }[],
): { html: string; used: Set<string> } {
  const byCid = new Map<string, { mimeType: string; content: ArrayBuffer | Uint8Array }>();
  for (const p of parts) {
    const cid = p.contentId?.replace(/^<|>$/g, "").trim();
    if (cid && INLINE_IMAGE_TYPES.has(p.mimeType.toLowerCase()) && typeof p.content !== "string") {
      byCid.set(cid.toLowerCase(), { mimeType: p.mimeType.toLowerCase(), content: p.content });
    }
  }
  const used = new Set<string>();
  let budget = EMAIL_INLINE_IMAGES_MAX_BYTES;
  const out = html.replace(/(["'])cid:([^"']+)\1/gi, (match, quote: string, raw: string) => {
    const cid = raw.trim().toLowerCase();
    const part = byCid.get(cid);
    if (!part || part.content.byteLength > budget) return match;
    budget -= part.content.byteLength;
    used.add(cid);
    return `${quote}data:${part.mimeType};base64,${Buffer.from(part.content instanceof Uint8Array ? part.content : new Uint8Array(part.content)).toString("base64")}${quote}`;
  });
  return { html: out, used };
}

/** One attachment's bytes, at the same index as in EmailPreview.attachments. */
export type EmailFile = { name: string; mimeType: string | null; content: Uint8Array };

type ParsedEmail = { email: EmailPreview; files: () => EmailFile[] };

const toBytes = (c: ArrayBuffer | Uint8Array | string): Uint8Array =>
  typeof c === "string"
    ? new TextEncoder().encode(c)
    : c instanceof Uint8Array
      ? c
      : new Uint8Array(c);

export async function parseEml(buffer: Buffer): Promise<EmailPreview> {
  return (await parseEmlFull(buffer)).email;
}

async function parseEmlFull(buffer: Buffer): Promise<ParsedEmail> {
  const mail = await PostalMime.parse(buffer, { attachmentEncoding: "arraybuffer" });
  const inlined = mail.html
    ? inlineCidImages(mail.html, mail.attachments)
    : { html: undefined, used: new Set<string>() };
  const shownInBody = (cid: string | undefined) =>
    !!cid && inlined.used.has(cid.replace(/^<|>$/g, "").trim().toLowerCase());
  // Parts shown in the body (cid images) aren't separate attachments.
  const listed = mail.attachments.filter(
    (a) => !shownInBody(a.contentId) && (a.disposition !== "inline" || !a.contentId),
  );
  const email: EmailPreview = {
    subject: mail.subject?.trim() || "(no subject)",
    from: addressList(mail.from)[0] ?? "",
    to: addressList(mail.to),
    cc: addressList(mail.cc),
    date: isoOrNull(mail.date),
    html: safeHtml(inlined.html),
    text: mail.text ?? "",
    attachments: listed.map((a) => ({
      name: a.filename || "(unnamed attachment)",
      size: byteSize(a.content),
    })),
  };
  return {
    email,
    files: () =>
      listed.map((a, i) => ({
        name: email.attachments[i].name,
        mimeType: a.mimeType || null,
        content: toBytes(a.content),
      })),
  };
}

export function parseMsg(buffer: Buffer): EmailPreview {
  return parseMsgFull(buffer).email;
}

function parseMsgFull(buffer: Buffer): ParsedEmail {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const reader = new MsgReader(view);
  const data = reader.getFileData();
  if (data.error) throw new Error(data.error);
  const recipients = data.recipients ?? [];
  const who = (type: "to" | "cc") =>
    recipients
      .filter((r) => (r.recipType ?? "to") === type)
      .map((r) => mailbox(r.name, r.smtpAddress || r.email))
      .filter(Boolean);
  const html = data.bodyHtml ?? (data.html ? new TextDecoder().decode(data.html) : undefined);
  const listed = (data.attachments ?? []).filter((a) => !a.attachmentHidden);
  const email: EmailPreview = {
    subject: data.subject?.trim() || "(no subject)",
    from: mailbox(data.senderName, data.senderSmtpAddress || data.senderEmail),
    to: who("to"),
    cc: who("cc"),
    date: isoOrNull(data.clientSubmitTime || data.messageDeliveryTime || data.creationTime),
    html: safeHtml(html),
    text: data.body ?? "",
    attachments: listed.map((a) => ({
      name: a.fileName || a.name || "(unnamed attachment)",
      size: a.contentLength ?? null,
    })),
  };
  return {
    email,
    files: () =>
      listed.map((a, i) => {
        const att = reader.getAttachment(a);
        return {
          name: email.attachments[i].name,
          mimeType: a.attachMimeTag || null,
          content: att.content ?? new Uint8Array(),
        };
      }),
  };
}

/**
 * An email's attachments as files, index-aligned with the preview's
 * attachment list (so chip i opens the document extracted from file i).
 * Throws on an unreadable email; the caller decides what that means.
 */
export async function readEmailFiles(buffer: Buffer, kind: "eml" | "msg"): Promise<EmailFile[]> {
  const parsed = kind === "eml" ? await parseEmlFull(buffer) : parseMsgFull(buffer);
  return parsed.files();
}

export async function renderStoredEmail(
  key: string,
  kind: "eml" | "msg",
): Promise<EmailPreviewResult> {
  const read = await readWhole(key, EMAIL_MAX_BYTES, "email");
  if (!read.ok) return read;
  try {
    const email = kind === "eml" ? await parseEml(read.buffer) : parseMsg(read.buffer);
    if (!email.html && email.text.trim() === "" && email.attachments.length === 0) {
      return { ok: false, reason: "The email has no readable content." };
    }
    return { ok: true, email };
  } catch {
    return {
      ok: false,
      reason: "The email file could not be read. It may be corrupt or in an unsupported format.",
    };
  }
}
