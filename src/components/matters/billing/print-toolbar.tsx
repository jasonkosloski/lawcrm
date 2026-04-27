/**
 * Print Toolbar — chrome strip at the top of /print/invoices/[id].
 *
 * Two responsibilities:
 *   1. Expose a manual "Print / Save as PDF" button, in case the
 *      auto-print prompt was dismissed or the page was reloaded.
 *   2. Auto-trigger `window.print()` once on mount when
 *      `?autoprint=1` is in the URL — the default for the
 *      print-affordance link from the action bar. We use a small
 *      delay so fonts + layout settle before the print preview
 *      snapshot is taken (otherwise serif fonts can render in a
 *      fallback face on the PDF).
 *
 * The toolbar itself is hidden in print via `@media print` rules
 * in `globals.css` (the `print:hidden` class).
 */

"use client";

import { useEffect } from "react";
import { Printer, X } from "lucide-react";

export function PrintToolbar({ autoprint }: { autoprint: boolean }) {
  useEffect(() => {
    if (!autoprint) return;
    // 250ms is enough for Inter / Fraunces / JetBrains Mono to
    // resolve their CSS font-face downloads on a warm cache; web-
    // fonts in the printed PDF look noticeably wrong otherwise.
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [autoprint]);

  return (
    <div className="print:hidden sticky top-0 z-10 bg-white border-b border-line">
      <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors"
        >
          <Printer size={13} />
          Print or save as PDF
        </button>
        <div className="text-2xs text-ink-4 ml-auto">
          Use your browser&apos;s print dialog → <strong>Save as PDF</strong>
        </div>
        <button
          type="button"
          onClick={() => window.close()}
          aria-label="Close print view"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
