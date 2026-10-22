/**
 * Print Toolbar — chrome strip at the top of /print/invoices/[id].
 *
 * Two responsibilities:
 *   1. Expose a manual "Print / Save as PDF" button, in case the
 *      auto-print prompt was dismissed or the page was reloaded.
 *   2. Auto-trigger `window.print()` once on mount when
 *      `?autoprint=1` is in the URL — the default for the
 *      print-affordance link from the action bar. We wait for
 *      `document.fonts.ready` (capped at 1.5 s) so fonts settle
 *      before the print preview snapshot is taken (otherwise serif
 *      fonts can render in a fallback face on the PDF).
 *
 * The toolbar itself is hidden in print via `@media print` rules
 * in `globals.css` (the `print:hidden` class).
 */

"use client";

import { useEffect } from "react";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Longest auto-print waits for web fonts before printing anyway. */
const AUTOPRINT_FONT_WAIT_MS = 1500;

export function PrintToolbar({ autoprint }: { autoprint: boolean }) {
  useEffect(() => {
    if (!autoprint) return;
    // Wait for the web fonts (Inter / Fraunces / JetBrains Mono) to
    // finish loading before the print snapshot — a fixed delay can
    // print with fallback faces on a cold cache. The race caps the
    // wait so a font that never resolves can't block printing, and
    // `document.fonts` may be missing (older engines, test DOM), in
    // which case the cap alone applies.
    let cancelled = false;
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((resolve) => {
      capTimer = setTimeout(resolve, AUTOPRINT_FONT_WAIT_MS);
    });
    const fontsReady: Promise<unknown> = document.fonts?.ready ?? cap;
    void Promise.race([fontsReady, cap]).then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
      clearTimeout(capTimer);
    };
  }, [autoprint]);

  return (
    <div className="print:hidden sticky top-0 z-10 bg-white border-b border-line">
      <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-2">
        <Button size="sm" type="button" onClick={() => window.print()}>
          <Printer size={13} />
          Print or save as PDF
        </Button>
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
