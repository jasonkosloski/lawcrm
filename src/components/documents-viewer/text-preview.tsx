/**
 * Plain-text + CSV preview bodies. The page reads the bytes
 * server-side (capped — see `src/lib/document-preview.ts`) and hands
 * the decoded text/rows down; React escaping keeps the content inert
 * so no sanitization is needed. Server-renderable.
 */

const MAX_TABLE_ROWS = 500;

function TruncationBanner({ downloadHref }: { downloadHref: string }) {
  return (
    <div className="rounded-md border border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn">
      Preview truncated at 1 MB —{" "}
      <a href={downloadHref} className="underline">
        download the full file
      </a>
      .
    </div>
  );
}

export function TextPreview({
  text,
  truncated,
  downloadHref,
}: {
  text: string;
  truncated: boolean;
  downloadHref: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {truncated && <TruncationBanner downloadHref={downloadHref} />}
      <pre className="scrollbar-thin min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-white p-4 font-mono text-xs leading-relaxed text-ink">
        {text}
      </pre>
    </div>
  );
}

/** CSV as a simple table — first row treated as the header. The
 *  page only calls this when `parseCsvPreview` returned clean rows;
 *  otherwise the raw text goes through `TextPreview`. */
export function CsvTablePreview({
  rows,
  truncated,
  downloadHref,
}: {
  rows: string[][];
  truncated: boolean;
  downloadHref: string;
}) {
  const [header, ...body] = rows;
  const shown = body.slice(0, MAX_TABLE_ROWS);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {truncated && <TruncationBanner downloadHref={downloadHref} />}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-white">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-paper-2">
            <tr>
              {header.map((h, i) => (
                <th
                  key={i}
                  className="border-b border-line px-3 py-2 text-left font-semibold text-ink-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, ri) => (
              <tr key={ri} className="odd:bg-white even:bg-paper-2/40">
                {r.map((c, ci) => (
                  <td
                    key={ci}
                    className="border-b border-line/60 px-3 py-1.5 align-top font-mono text-2xs text-ink"
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {body.length > MAX_TABLE_ROWS && (
          <div className="px-3 py-2 text-2xs text-ink-4">
            Showing the first {MAX_TABLE_ROWS} of {body.length} rows.
          </div>
        )}
      </div>
    </div>
  );
}
