/**
 * Fallback / error card for the document viewer body.
 *
 * One component, three uses:
 *  - unsupported type ("this doesn't render inline — download it")
 *  - conversion/read failure (docx pipeline, capped text read)
 *  - document row with no stored file (seeded rows)
 *
 * Server-renderable — no interactivity beyond plain links.
 */

import { FileWarning, Download } from "lucide-react";

export function ViewerFallbackCard({
  title,
  detail,
  downloadHref,
  downloadName,
}: {
  title: string;
  detail: string;
  /** Omit when there's no file to download (seeded rows). */
  downloadHref?: string;
  downloadName?: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg border border-line bg-paper-2 p-8 text-center">
        <FileWarning className="h-8 w-8 text-ink-4" aria-hidden />
        <div>
          <div className="text-sm font-semibold text-ink">{title}</div>
          <div className="mt-1 text-xs text-ink-3">{detail}</div>
        </div>
        {downloadHref && (
          <a
            href={downloadHref}
            download={downloadName}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:border-brand-300 hover:text-brand-700"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download file
          </a>
        )}
      </div>
    </div>
  );
}
