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
 * `?autoprint=1` so the browser's print dialog opens immediately.
 * Hand-typed URLs (or page reloads after dismissing the dialog)
 * skip the auto-print so the user isn't ambushed by it on every
 * refresh.
 *
 * Auth: uses the same gating model as the live preview —
 * `getInvoiceById` returns null for missing ids; we 404 in that
 * case. The richer "user can see this invoice's matter" check
 * inherits from the firm scope (single-tenant today; multi-tenant
 * via session.firmId later).
 */

import { notFound } from "next/navigation";
import { InvoicePreview } from "@/components/matters/billing/invoice-preview";
import { PrintToolbar } from "@/components/matters/billing/print-toolbar";
import { getCurrentFirm } from "@/lib/firm";
import { getInvoiceById } from "@/lib/queries/billing";

export default async function PrintInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  const [{ id }, sp, firm] = await Promise.all([
    params,
    searchParams,
    getCurrentFirm(),
  ]);
  const invoice = await getInvoiceById(id);
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
          <InvoicePreview invoice={invoice} firm={firm} printMode />
        </div>
      </main>
    </div>
  );
}
