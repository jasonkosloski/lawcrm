/**
 * Print layout — chrome-free wrapper for printable / PDF-export
 * pages.
 *
 * Sits OUTSIDE the (dashboard) route group so the sidebar +
 * topbar don't render. The root layout still provides the html /
 * body / fonts / Providers wrapper; this layout just adds a
 * white background and a small "print this page" toolbar that
 * itself hides during print via `@media print`.
 *
 * Pages under `/print/*` should render their document content
 * directly — no surrounding cards, no max-width gutters — so
 * the printed output matches the on-screen render.
 */

export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-white text-ink">
      {children}
    </div>
  );
}
