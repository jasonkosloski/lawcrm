/**
 * Excel (.xlsx) preview — every sheet as a table, stacked, with a
 * jump list when there's more than one. Server-rendered from
 * `renderStoredSpreadsheet` (values only, capped), so the cell text
 * is real DOM text and TextReview's select-to-flag / click-to-
 * highlight works exactly as on a Word document. Sheets are stacked
 * rather than tabbed for the same reason: a quote on another sheet
 * must be in the DOM to be found.
 */

import type { SpreadsheetSheet } from "@/lib/office-preview";
import { SPREADSHEET_MAX_COLS, SPREADSHEET_MAX_ROWS } from "@/lib/office-preview";

/** 0 → A, 25 → Z, 26 → AA — Excel's column letters. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function SpreadsheetPreview({
  sheets,
  hiddenSheets,
}: {
  sheets: SpreadsheetSheet[];
  hiddenSheets: number;
}) {
  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-auto rounded-lg border border-line bg-paper-2 p-3">
      {sheets.length > 1 && (
        <nav aria-label="Sheets" className="flex flex-wrap gap-1.5">
          {sheets.map((s, i) => (
            <a
              key={i}
              href={`#sheet-${i + 1}`}
              className="rounded-md border border-line bg-white px-2 py-1 text-2xs text-ink-3 hover:border-brand-300 hover:text-brand-700"
            >
              {s.name}
            </a>
          ))}
        </nav>
      )}
      {sheets.map((s, i) => (
        <section key={i} id={`sheet-${i + 1}`} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-ink">{s.name}</h3>
          {s.rows.length === 0 ? (
            <div className="text-2xs text-ink-4">Empty sheet.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line bg-white">
              <table className="border-collapse text-xs">
                <thead className="bg-paper-2">
                  <tr>
                    <th className="w-10 border-b border-r border-line px-2 py-1 text-2xs font-normal text-ink-4" />
                    {s.rows[0].map((_, ci) => (
                      <th
                        key={ci}
                        className="border-b border-r border-line px-2 py-1 text-center text-2xs font-normal text-ink-4"
                      >
                        {columnLetter(ci)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r, ri) => (
                    <tr key={ri}>
                      <td className="border-b border-r border-line bg-paper-2 px-2 py-1 text-right text-2xs text-ink-4">
                        {ri + 1}
                      </td>
                      {r.map((c, ci) => (
                        <td
                          key={ci}
                          className="max-w-xs border-b border-r border-line/60 px-2 py-1 align-top text-xs text-ink whitespace-pre-wrap break-words"
                        >
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(s.hiddenRows > 0 || s.hiddenCols > 0) && (
            <div className="text-2xs text-ink-4">
              Showing the first {SPREADSHEET_MAX_ROWS.toLocaleString()} rows and{" "}
              {SPREADSHEET_MAX_COLS} columns
              {s.hiddenRows > 0 && ` (${s.hiddenRows.toLocaleString()} more rows)`}
              {s.hiddenCols > 0 && ` (${s.hiddenCols} more columns)`} — download the file for the
              rest.
            </div>
          )}
        </section>
      ))}
      {hiddenSheets > 0 && (
        <div className="text-2xs text-ink-4">
          {hiddenSheets} more {hiddenSheets === 1 ? "sheet isn't" : "sheets aren't"} shown —
          download the file to see {hiddenSheets === 1 ? "it" : "them"}.
        </div>
      )}
      <div className="text-2xs text-ink-4">
        Values only: formatting, formulas, charts and images aren&apos;t shown.
      </div>
    </div>
  );
}
