/**
 * RFC 2822/5322 MIME message builder for Gmail send — plus the
 * reply-recipient/subject derivation the send actions and the reply
 * composer share.
 *
 * Deliberately pure and CLIENT-SAFE: no Buffer, no node imports —
 * the compose/reply UI imports `parseAddressList` /
 * `plainTextToHtml` for client-side validation, so base64 is done
 * with a hand-rolled encoder over `TextEncoder` bytes.
 *
 * What the builder emits:
 *   - From / To / Cc (validated addresses; display names quoted or
 *     RFC 2047-encoded as needed)
 *   - Subject with RFC 2047 UTF-8 B-encoding for non-ASCII
 *     (chunked ≤ 42 UTF-8 bytes per encoded-word so each stays
 *     under the 75-char limit, folded with leading whitespace)
 *   - Date (RFC 2822, UTC) — Message-ID is deliberately OMITTED so
 *     Gmail assigns its own on send
 *   - text/plain + text/html as multipart/alternative, each part
 *     base64 content-transfer-encoded and wrapped at 76 columns
 *     (that's where RFC 2045's 76-col rule applies)
 *   - Optional In-Reply-To / References for replies
 *
 * `encodeMimeForGmail` produces the `raw` value for
 * `users/me/messages/send`: base64url of the whole message,
 * UNWRAPPED — the raw field is a JSON string, not a MIME body, so
 * the 76-col convention does not apply there (Google's own client
 * libraries emit it unwrapped; embedded newlines are what breaks).
 *
 * Attachments are a documented follow-up (v1 is text-only): they
 * need multipart/mixed nesting + the upload endpoint for >5 MB.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface MimeAddress {
  name?: string;
  email: string;
}

export interface MimeMessageInput {
  from: MimeAddress;
  to: MimeAddress[];
  cc?: MimeAddress[];
  subject: string;
  /** Plain-text body — the text/plain part, verbatim. */
  text: string;
  /** HTML body — the text/html part, verbatim. */
  html: string;
  /** Defaults to now. Injectable for deterministic tests. */
  date?: Date;
  /** Message-ID being replied to ("<id@host>" — angle brackets
   *  added when missing). Omitted when not derivable; Gmail still
   *  threads server-side via the send payload's `threadId`. */
  inReplyTo?: string;
  references?: string[];
  /** Injectable for deterministic tests. The default's `=_` prefix
   *  can never collide with base64 part content ("=" only appears
   *  as trailing padding). */
  boundary?: string;
}

// ── Address validation / parsing ─────────────────────────────────────────

/** Pragmatic addr-spec check: one @, no whitespace/angle-brackets/
 *  separators, dotted domain. Full RFC 5321 grammar (quoted local
 *  parts etc.) is deliberately out of scope for a compose form. */
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

export function isValidEmailAddress(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Parse a comma/semicolon-separated address list from the compose
 *  form. Valid addresses are trimmed + case-insensitively deduped
 *  (first spelling wins); everything else lands in `invalid` so the
 *  UI can name the offender. */
export function parseAddressList(raw: string): {
  addresses: string[];
  invalid: string[];
} {
  const addresses: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const token of raw.split(/[,;]/)) {
    const t = token.trim();
    if (!t) continue;
    if (!isValidEmailAddress(t)) {
      invalid.push(t);
      continue;
    }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(t);
  }
  return { addresses, invalid };
}

// ── Base64 (client-safe, no Buffer) ──────────────────────────────────────

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64[b2 & 0x3f];
  }
  return out;
}

function utf8Base64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

/** RFC 2045 body wrapping — 76 chars per line, CRLF line ends. */
function wrap76(b64: string): string {
  return b64.replace(/(.{76})(?=.)/g, "$1\r\n");
}

/** base64url (RFC 4648 §5, unpadded, UNWRAPPED) of the full RFC 2822
 *  message — the Gmail API's `raw` field. See module header for why
 *  this is not 76-col wrapped. */
export function encodeMimeForGmail(message: string): string {
  return utf8Base64(message)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Header encoding (RFC 2047) ───────────────────────────────────────────

/** Max UTF-8 bytes per encoded-word chunk: 42 bytes → 56 base64
 *  chars → 68 chars with the =?UTF-8?B?…?= frame, under RFC 2047's
 *  75-char encoded-word cap. */
const ENCODED_WORD_MAX_BYTES = 42;

const ASCII_PRINTABLE_RE = /^[\x20-\x7e]*$/;

/** Strip header-injection material — CR/LF (and stray tabs) can
 *  never survive into a structured header we assemble. */
function sanitizeHeaderText(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

/** Encode arbitrary text for a header value: ASCII passes through
 *  untouched; anything else becomes UTF-8 B-encoded words, chunked
 *  at code-point boundaries and folded with `CRLF SP` (adjacent
 *  encoded-words separated by folding whitespace collapse on
 *  decode). Exported for the Subject tests. */
export function encodeHeaderText(value: string): string {
  const clean = sanitizeHeaderText(value);
  if (ASCII_PRINTABLE_RE.test(clean)) return clean;

  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const ch of clean) {
    const chBytes = encoder.encode(ch).length;
    if (chunkBytes + chBytes > ENCODED_WORD_MAX_BYTES && chunk) {
      words.push(`=?UTF-8?B?${utf8Base64(chunk)}?=`);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += ch;
    chunkBytes += chBytes;
  }
  if (chunk) words.push(`=?UTF-8?B?${utf8Base64(chunk)}?=`);
  return words.join("\r\n ");
}

/** RFC 5322 `specials` that force a display name into a
 *  quoted-string. */
const NAME_NEEDS_QUOTING_RE = /[()<>[\]:;@\\,."]/;

function formatDisplayName(name: string): string {
  const clean = sanitizeHeaderText(name);
  if (!clean) return "";
  if (!ASCII_PRINTABLE_RE.test(clean)) return encodeHeaderText(clean);
  if (NAME_NEEDS_QUOTING_RE.test(clean)) {
    return `"${clean.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  }
  return clean;
}

/** One mailbox for an address header: `Name <a@b>` / bare `a@b`.
 *  Throws on an invalid address — callers validate user input first;
 *  this guards programming errors. */
export function formatAddress(addr: MimeAddress): string {
  const email = addr.email.trim();
  if (!isValidEmailAddress(email)) {
    throw new Error(`Invalid email address in MIME header: "${addr.email}"`);
  }
  const name = addr.name ? formatDisplayName(addr.name) : "";
  return name ? `${name} <${email}>` : email;
}

function formatAddressListHeader(list: MimeAddress[]): string {
  // Fold one mailbox per line — keeps every header line well under
  // the 998-char hard limit no matter how many recipients.
  return list.map(formatAddress).join(",\r\n ");
}

// ── Date ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** RFC 2822 date-time, always rendered in UTC (+0000). */
export function formatRfc2822Date(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${DAY_NAMES[date.getUTCDay()]}, ${p(date.getUTCDate())} ` +
    `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} +0000`
  );
}

// ── Message assembly ─────────────────────────────────────────────────────

function ensureAngleBrackets(id: string): string {
  const clean = sanitizeHeaderText(id);
  return clean.startsWith("<") ? clean : `<${clean}>`;
}

function generateBoundary(): string {
  // `=_` prefix cannot occur inside base64 part content ("=" is
  // only ever trailing padding), so the boundary is collision-free.
  const rand = (): string => Math.random().toString(36).slice(2, 10);
  return `=_lawcrm_${Date.now().toString(36)}_${rand()}${rand()}`;
}

/** Build the full RFC 2822 message (CRLF line endings throughout).
 *  Feed the result to `encodeMimeForGmail` for the API's `raw`. */
export function buildMimeMessage(input: MimeMessageInput): string {
  if (input.to.length === 0) {
    throw new Error("MIME message requires at least one To recipient");
  }
  const boundary = input.boundary ?? generateBoundary();

  const headers: string[] = [
    `From: ${formatAddress(input.from)}`,
    `To: ${formatAddressListHeader(input.to)}`,
  ];
  if (input.cc && input.cc.length > 0) {
    headers.push(`Cc: ${formatAddressListHeader(input.cc)}`);
  }
  headers.push(`Subject: ${encodeHeaderText(input.subject)}`);
  headers.push(`Date: ${formatRfc2822Date(input.date ?? new Date())}`);
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${ensureAngleBrackets(input.inReplyTo)}`);
  }
  if (input.references && input.references.length > 0) {
    headers.push(
      `References: ${input.references.map(ensureAngleBrackets).join("\r\n ")}`
    );
  }
  headers.push("MIME-Version: 1.0");
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const part = (contentType: string, content: string): string =>
    [
      `--${boundary}`,
      `Content-Type: ${contentType}; charset=UTF-8`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(utf8Base64(content)),
    ].join("\r\n");

  return [
    headers.join("\r\n"),
    "",
    // text/plain first, text/html last — multipart/alternative
    // convention is least- to most-preferred.
    part("text/plain", input.text),
    part("text/html", input.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// ── Plain text → minimal HTML ────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The composer's plain-text body as minimal HTML: blank-line-
 *  separated paragraphs → `<p>`, single newlines → `<br />`,
 *  everything HTML-escaped. Rich text is a documented follow-up. */
export function plainTextToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`);
  return paragraphs.join("") || "<p></p>";
}

// ── Reply derivation ─────────────────────────────────────────────────────

/** What the derivation needs from each stored EmailMessage, oldest
 *  first (matching `getThreadById`'s ordering). */
export interface ReplySourceMessage {
  fromName: string;
  fromEmail: string;
  toRecipients: MimeAddress[];
  ccRecipients: MimeAddress[];
}

/** "Re: " prefix — strip however many are stacked, then add exactly
 *  one back. */
const RE_PREFIX = /^\s*(re\s*:\s*)+/i;

export function buildReplySubject(subject: string): string {
  return `Re: ${subject.replace(RE_PREFIX, "").trim()}`.trim();
}

/**
 * Reply recipients from a thread's messages:
 *
 *   - Anchor on the LAST INBOUND message (from ≠ the account's own
 *     address). Reply → its From. Reply-all → its From + To + Cc,
 *     with the account's own address excluded and case-insensitive
 *     dedupe across the whole set (To wins over Cc).
 *   - When every message is outbound (following up on your own sent
 *     thread), reply continues to that message's To (reply-all adds
 *     its Cc).
 *
 * Returns empty lists when nothing is derivable — callers surface
 * "edit the recipients" instead of guessing.
 */
export function deriveReplyRecipients(
  messages: ReplySourceMessage[],
  ownEmail: string,
  replyAll: boolean
): { to: MimeAddress[]; cc: MimeAddress[] } {
  const own = ownEmail.trim().toLowerCase();
  const isOwn = (email: string): boolean =>
    email.trim().toLowerCase() === own;

  const inbound = [...messages].reverse().find((m) => !isOwn(m.fromEmail));
  const base = inbound ?? messages[messages.length - 1];
  if (!base) return { to: [], cc: [] };

  const seen = new Set<string>([own]);
  const add = (list: MimeAddress[], addr: MimeAddress): void => {
    const email = addr.email.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) return;
    seen.add(key);
    list.push(addr.name ? { name: addr.name, email } : { email });
  };

  const to: MimeAddress[] = [];
  const cc: MimeAddress[] = [];
  if (inbound) {
    add(to, {
      name: inbound.fromName || undefined,
      email: inbound.fromEmail,
    });
    if (replyAll) {
      for (const r of base.toRecipients) add(to, r);
      for (const r of base.ccRecipients) add(cc, r);
    }
  } else {
    for (const r of base.toRecipients) add(to, r);
    if (replyAll) for (const r of base.ccRecipients) add(cc, r);
  }
  return { to, cc };
}
