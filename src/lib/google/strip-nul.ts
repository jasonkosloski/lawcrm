/**
 * PostgreSQL `text` columns reject U+0000 ("invalid byte sequence for
 * encoding UTF8: 0x00"), and nothing upstream of our inserts removes
 * it: a base64 body part can carry 0x00 (or be UTF-16 mis-decoded as
 * UTF-8), and `=?UTF-8?B?AA==?=` decodes to a NUL in a Subject. Any
 * string that came from Google and is about to be persisted goes
 * through this first so one hostile or odd message can't poison an
 * insert.
 */
export function stripNul(value: string): string {
  return value.includes("\u0000") ? value.replace(/\u0000/g, "") : value;
}

/** Null-tolerant variant for optional columns. */
export function stripNulOrNull(value: string | null | undefined): string | null {
  return value == null ? null : stripNul(value);
}
