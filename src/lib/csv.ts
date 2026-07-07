/**
 * CSV building helpers — pure, dependency-free.
 *
 * Used by the contact bulk-export action (and any future "download
 * as CSV" surface). RFC 4180 flavor: cells containing a comma,
 * double quote, or line break are wrapped in double quotes with
 * embedded quotes doubled; rows join with CRLF (what Excel and
 * Numbers both expect from a .csv).
 *
 * Formula-injection guard: cells starting with `=` or `@` get a
 * leading apostrophe so a hostile contact name ("=HYPERLINK(...)")
 * can't execute when the export is opened in a spreadsheet. `+` and
 * `-` are deliberately NOT guarded — phone numbers ("+1 303…") and
 * negative amounts are legitimate leading characters, and a bare
 * +/− cell evaluates to a number, not code.
 */

const NEEDS_QUOTING = /[",\r\n]/;

/** Escape a single cell. null/undefined render as an empty cell. */
export function csvEscape(value: string | null | undefined): string {
  if (value == null) return "";
  let v = value;
  if (v.startsWith("=") || v.startsWith("@")) v = `'${v}`;
  if (NEEDS_QUOTING.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

/**
 * Build a complete CSV document: one header row plus data rows,
 * every cell escaped, CRLF line endings with a trailing newline.
 */
export function buildCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | null | undefined>>
): string {
  const lines = [header, ...rows].map((cells) =>
    cells.map(csvEscape).join(",")
  );
  return lines.join("\r\n") + "\r\n";
}
