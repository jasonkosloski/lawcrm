/**
 * Print layout — chrome-free wrapper for printable / PDF-export
 * pages.
 *
 * Sits OUTSIDE the (dashboard) route group so the sidebar +
 * topbar don't render. The root layout still provides the html /
 * body / fonts / Providers wrapper; this layout just adds a
 * white background. It reads no data and does not authenticate —
 * each page under /print authenticates itself (a layout is not an
 * auth gate; see src/app/page-guards.test.ts).
 *
 * Pages under `/print/*` render their document content directly —
 * no surrounding cards, no max-width gutters beyond their own — and
 * own their on-screen toolbar (e.g. PrintToolbar), which hides during
 * print via `@media print`, so the printed output matches the
 * on-screen render.
 */

import { StaffClerkProvider } from "@/components/auth/staff-clerk-provider";

export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StaffClerkProvider>
      <div className="min-h-full bg-white text-ink">{children}</div>
    </StaffClerkProvider>
  );
}
