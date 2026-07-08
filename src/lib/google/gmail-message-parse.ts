/**
 * Pure Gmail-payload parsing helpers for the sync engine.
 *
 * Everything in this module is deterministic string/JSON work with
 * no I/O — the DB writes and `gmailFetch` orchestration live in
 * `gmail-sync.ts`. Keeping the parsing pure makes the MIME-walk and
 * address-parser fixtures trivially unit-testable.
 *
 * Covers:
 *   - base64url body decoding (Gmail's `body.data` encoding);
 *   - RFC 2047 encoded-word decoding for header display names
 *     ("=?UTF-8?B?...?=" — real-world From headers use these);
 *   - a small RFC 5322 address-LIST parser (display-name + angle-addr,
 *     quoted display names containing commas, bare addresses) — a
 *     deliberate subset, no dependency; group syntax degrades to
 *     "skip tokens without an @";
 *   - the MIME walk: prefer text/html anywhere in the part tree,
 *     fall back to text/plain wrapped into escaped <p>/<br> HTML;
 *   - attachment metadata collection (parts with a filename +
 *     attachmentId);
 *   - label→flag mapping. Gmail SYSTEM label ids (INBOX, UNREAD,
 *     STARRED, IMPORTANT, SENT, DRAFT, SPAM, TRASH, CHAT and the
 *     CATEGORY_* tab noise) are filtered out of EmailLabel rows —
 *     only user-created labels (ids starting with "Label_") become
 *     visible labels; the system ids only feed the boolean flags.
 */

// ── Gmail API payload shapes (the subset the sync engine reads) ─────────

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailBody {
  attachmentId?: string;
  size?: number;
  /** base64url-encoded content (absent on container / attachment parts). */
  data?: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  /** Epoch ms as a decimal string. */
  internalDate?: string;
  payload?: GmailMessagePart;
}

export interface GmailThread {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
}

export interface EmailAddress {
  name: string;
  email: string;
}

// ── Decoding primitives ──────────────────────────────────────────────────

/** Decode Gmail's base64url `body.data` to a UTF-8 string. */
export function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

/** Decode a raw header byte-string per `charset` with a UTF-8
 *  fallback for charsets TextDecoder doesn't know. */
function decodeCharset(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/**
 * RFC 2047 encoded-word decoding for header values:
 * `=?charset?B?base64?=` and `=?charset?Q?quoted-printable?=`.
 * Whitespace between two adjacent encoded words is dropped per the
 * RFC; anything malformed passes through untouched.
 */
export function decodeMimeWords(raw: string): string {
  return raw
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g,
      (whole, charset: string, enc: string, text: string) => {
        try {
          let bytes: Buffer;
          if (enc.toLowerCase() === "b") {
            bytes = Buffer.from(text, "base64");
          } else {
            // Q-encoding: "_" is a space; "=XX" is a raw byte.
            const raw8bit = text
              .replace(/_/g, " ")
              .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
                String.fromCharCode(parseInt(hex, 16))
              );
            bytes = Buffer.from(raw8bit, "latin1");
          }
          return decodeCharset(bytes, charset);
        } catch {
          return whole;
        }
      }
    );
}

/** Decode the handful of HTML entities Gmail uses in `snippet`
 *  values (snippets arrive HTML-escaped; we store display text). */
export function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_m, code: string) =>
      String.fromCodePoint(parseInt(code, 10))
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// ── Header access ────────────────────────────────────────────────────────

/** Case-insensitive header lookup on a message payload. */
export function headerValue(
  payload: GmailMessagePart | undefined,
  name: string
): string | null {
  const lower = name.toLowerCase();
  const hit = payload?.headers?.find((h) => h.name.toLowerCase() === lower);
  return hit ? hit.value : null;
}

// ── RFC 5322 address-list parsing (subset) ───────────────────────────────

/** Split an address list on top-level commas — commas inside quoted
 *  strings ("Smith, Jane") or angle brackets don't split. */
function splitAddressList(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && raw[i - 1] !== "\\") inQuotes = !inQuotes;
    if (!inQuotes) {
      if (ch === "<") angleDepth++;
      else if (ch === ">") angleDepth = Math.max(0, angleDepth - 1);
      else if (ch === "," && angleDepth === 0) {
        out.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Strip surrounding quotes + backslash escapes from a display name. */
function cleanDisplayName(name: string): string {
  let n = name.trim();
  if (n.startsWith('"') && n.endsWith('"') && n.length >= 2) {
    n = n.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return decodeMimeWords(n).trim();
}

/**
 * Parse an RFC 5322 address list header value ("From", "To", "Cc")
 * into `{name, email}` pairs.
 *
 * Handles: `Name <a@b>`, `"Last, First" <a@b>`, bare `a@b`,
 * RFC 2047 encoded display names. Tokens without an "@" (e.g. the
 * `undisclosed-recipients:;` group marker) are skipped — a
 * deliberate subset that covers real-world Gmail headers without a
 * dependency.
 */
export function parseAddressList(
  raw: string | null | undefined
): EmailAddress[] {
  if (!raw || !raw.trim()) return [];
  const results: EmailAddress[] = [];
  for (const token of splitAddressList(raw)) {
    // [\s\S] instead of the dotall flag — tsconfig targets pre-es2018.
    const angle = token.match(/^([\s\S]*?)<([^<>]*)>\s*$/);
    if (angle) {
      const email = angle[2].trim();
      if (!email.includes("@")) continue;
      results.push({ name: cleanDisplayName(angle[1]), email });
      continue;
    }
    // Bare address (possibly with a trailing (comment)).
    const bare = token.replace(/\([^)]*\)/g, "").trim();
    if (!bare.includes("@")) continue;
    results.push({ name: "", email: bare });
  }
  return results;
}

// ── Plain-text → HTML fallback ───────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a text/plain body and wrap it into paragraph HTML:
 *  blank-line-separated blocks become `<p>`, single newlines become
 *  `<br>`. The output goes through the email sanitizer like any
 *  other body — this is layout, not a security step. */
export function textToHtml(text: string): string {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return "";
  return blocks
    .map((b) => `<p>${escapeHtml(b).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ── MIME walk ────────────────────────────────────────────────────────────

/** Depth-first search for the first part matching `mimeType` that
 *  carries inline data (skips attachment parts — those have a
 *  filename). multipart/alternative lists plain before html, so a
 *  type-targeted DFS finds the right alternative either way. */
function findPartWithData(
  part: GmailMessagePart | undefined,
  mimeType: string
): GmailMessagePart | null {
  if (!part) return null;
  if (
    part.mimeType?.toLowerCase() === mimeType &&
    part.body?.data &&
    !part.filename
  ) {
    return part;
  }
  for (const child of part.parts ?? []) {
    const hit = findPartWithData(child, mimeType);
    if (hit) return hit;
  }
  return null;
}

/**
 * Extract the display body from a message payload as UNSANITIZED
 * HTML. Preference order:
 *   1. any text/html part (multipart/alternative's rich variant,
 *      however deeply nested under multipart/mixed|related);
 *   2. text/plain, escaped + wrapped into paragraphs;
 *   3. "" — caller falls back to the snippet.
 *
 * The caller MUST pass the result through `sanitizeEmailHtml`
 * before persisting — this function does no security work.
 */
export function extractBodyHtml(payload: GmailMessagePart | undefined): string {
  const html = findPartWithData(payload, "text/html");
  if (html?.body?.data) return decodeBase64Url(html.body.data);
  const plain = findPartWithData(payload, "text/plain");
  if (plain?.body?.data) return textToHtml(decodeBase64Url(plain.body.data));
  return "";
}

export interface AttachmentMeta {
  filename: string;
  mimeType: string | null;
  size: number | null;
  /** Gmail attachment id — needed for the (future) on-demand bytes
   *  fetch via users/me/messages/{id}/attachments/{attachmentId}.
   *  NOTE: Gmail does not guarantee these are stable across fetches. */
  attachmentId: string | null;
}

/** Collect attachment metadata: any part with a filename. Inline
 *  data-less container parts and body parts are skipped. */
export function collectAttachments(
  payload: GmailMessagePart | undefined
): AttachmentMeta[] {
  const out: AttachmentMeta[] = [];
  const walk = (part: GmailMessagePart | undefined): void => {
    if (!part) return;
    if (part.filename) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType ?? null,
        size: part.body?.size ?? null,
        attachmentId: part.body?.attachmentId ?? null,
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return out;
}

// ── Labels + flags ───────────────────────────────────────────────────────

/** User-created Gmail labels have ids like "Label_123…"; everything
 *  else (INBOX, UNREAD, STARRED, IMPORTANT, SENT, DRAFT, SPAM,
 *  TRASH, CHAT, CATEGORY_*) is a system id we never persist as an
 *  EmailLabel row — the interesting ones feed the boolean flags,
 *  the CATEGORY_* tab classifications are pure noise. */
export function isUserLabelId(labelId: string): boolean {
  return labelId.startsWith("Label_");
}

/** Store Gmail user labels in the documented `custom:*` namespace of
 *  `EmailLabel.label` ("Clients/Smith" → "custom:clients_smith").
 *  The sync engine OWNS the `custom:` namespace on synced threads
 *  and reconciles it every pass; app-vocabulary labels (privileged,
 *  opposing_counsel, …) are never touched. */
export function gmailLabelSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `custom:${slug || "label"}`;
}

export interface ThreadFlags {
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
}

/** Thread-level flag mapping:
 *  - isRead: NO message carries UNREAD;
 *  - isStarred: ANY message carries STARRED;
 *  - isArchived: NO message carries INBOX. */
export function threadFlags(messages: GmailMessage[]): ThreadFlags {
  const has = (label: string) =>
    messages.some((m) => (m.labelIds ?? []).includes(label));
  return {
    isRead: !has("UNREAD"),
    isStarred: has("STARRED"),
    isArchived: !has("INBOX"),
  };
}

// ── Whole-message parse ──────────────────────────────────────────────────

export interface ParsedGmailMessage {
  externalId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  sentAt: Date;
  /** UNSANITIZED display HTML — sanitize before persisting. */
  bodyHtmlRaw: string;
  attachments: AttachmentMeta[];
}

/** Parse one Gmail message into the shape the DB layer persists.
 *  Body falls back to the (entity-decoded) snippet when the MIME
 *  tree has no readable part. */
export function parseGmailMessage(m: GmailMessage): ParsedGmailMessage {
  const from = parseAddressList(headerValue(m.payload, "From"))[0] ?? {
    name: "",
    email: "",
  };
  const bodyHtmlRaw =
    extractBodyHtml(m.payload) ||
    (m.snippet ? textToHtml(decodeHtmlEntities(m.snippet)) : "");
  return {
    externalId: m.id,
    from,
    to: parseAddressList(headerValue(m.payload, "To")),
    cc: parseAddressList(headerValue(m.payload, "Cc")),
    sentAt: new Date(Number(m.internalDate ?? Date.now())),
    bodyHtmlRaw,
    attachments: collectAttachments(m.payload),
  };
}
