/**
 * Print Invoice — letterhead-only render of a single invoice for
 * printing or saving as PDF.
 *
 * Layout-wise this lives outside the (dashboard) group so there's
 * no sidebar/topbar — the page IS the document. The on-screen
 * version shows a small `PrintToolbar` at the top with a manual
 * Print button + close-window button; both hide in print via
 * `@media print` rules.
 *
 * Auto-print: pages opened from the matter Billing tab pass
 * `?autoprint=1` so the browser's print dialog opens immediately
 * (once web fonts have loaded). Hand-typed URLs (or page reloads
 * after dismissing the dialog) skip the auto-print so the user isn't
 * ambushed by it on every refresh.
 *
 * Title: `generateMetadata` names the document "Invoice <number>" —
 * browsers default the Save-as-PDF filename to document.title, so
 * without it every PDF would be named after the app.
 *
 * Auth: requires `billing.view` (`requirePermission`, first statement —
 * this route sits outside the (dashboard) layout, so the page must
 * authenticate itself; `generateMetadata` authenticates too, before
 * it reads the invoice). Gated by `billing.view` (the same key as the
 * matter Billing tab) PLUS matter access (`assertChildMatterAccess("invoice", id)`, 404 when hidden).  `getInvoiceById`
 * returns null for missing ids; we 404 in that case. Firm scoping
 * is not enforced (single-tenant today).
 */

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoicePreview } from "@/components/matters/billing/invoice-preview";
import { PrintToolbar } from "@/components/matters/billing/print-toolbar";
import { getCurrentFirm } from "@/lib/firm";
import { getInvoiceById } from "@/lib/queries/billing";
import { requirePermission } from "@/lib/permission-check";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";

// The page and generateMetadata both need the invoice; cache() makes
// the second read free within a request.
const loadInvoice = cache(getInvoiceById);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await requirePermission("billing.view");
  const { id } = await params;
  // Matter wall: an invoice on a hidden matter 404s (also for the title).
  await assertChildMatterAccess("invoice", id);
  const invoice = await loadInvoice(id);
  return {
    // Generic when the invoice is missing — the page 404s anyway.
    title: invoice ? `Invoice ${invoice.invoiceNumber}` : "Invoice",
    robots: { index: false, follow: false },
  };
}

export default async function PrintInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  await requirePermission("billing.view");
  const { id: invoiceId } = await params;
  // Matter wall: the invoice's matter must be accessible (404 if not).
  await assertChildMatterAccess("invoice", invoiceId);
  const [{ id }, sp, firm, timeZone] = await Promise.all([
    params,
    searchParams,
    getCurrentFirm(),
    getCurrentUserTimeZone(),
  ]);
  const invoice = await loadInvoice(id);
  if (!invoice) notFound();

  const autoprint = sp.autoprint === "1";

  return (
    <div className="min-h-screen bg-white">
      <PrintToolbar autoprint={autoprint} />
      {/* The preview itself is full-bleed inside an 8.5"-ish
          container — the InvoicePreview's letterhead already
          accounts for the inner padding. We constrain max-width
          on screen so the doc reads at human scale, but `@media
          print` removes the outer padding so the page bleeds
          edge-to-edge of the printable area. */}
      <main className="max-w-3xl mx-auto print:max-w-none print:mx-0 p-6 print:p-0">
        <div className="border border-line print:border-0 rounded-md print:rounded-none overflow-hidden bg-white">
          <InvoicePreview invoice={invoice} firm={firm} timeZone={timeZone} printMode />
        </div>
      </main>
    </div>
  );
}
