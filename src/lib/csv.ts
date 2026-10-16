/**
 * CSV building helpers — pure, dependency-free.
 *
 * Used by the contact bulk-export action (and any future "download
 * as CSV" surface). RFC 4180 flavor: cells containing a comma,
 * double quote, or line break are wrapped in double quotes with
 * embedded quotes doubled; rows join with CRLF (what Excel and
 * Numbers both expect from a .csv).
 *
 * Formula-injection guard (OWASP CSV injection): cells starting with
 * `=`, `+`, `-`, `@`, TAB or CR get a leading apostrophe so a hostile
 * contact name ("=HYPERLINK(...)", "+HYPERLINK(...)", "-2+3",
 * "+cmd|' /C calc'!A0") can't execute when the export is opened in a
 * spreadsheet - Excel and Sheets treat a leading `+` / `-` as the start
 * of a formula just like `=`. The one exemption is a value made ONLY of
 * an optional sign, digits and phone/number punctuation
 * ("+1 (303) 555-0101", "-42", "1,234.50"): with no letters it cannot
 * name a function, cell reference or DDE command, so it stays
 * unmangled.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const PLAIN_NUMBER_OR_PHONE = /^[+-]?\d[\d\s().,-]*$/;

/** Escape a single cell. null/undefined render as an empty cell. */
export function csvEscape(value: string | null | undefined): string {
  if (value == null) return "";
  let v = value;
  if (FORMULA_LEAD.test(v) && !PLAIN_NUMBER_OR_PHONE.test(v)) v = `'${v}`;
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
