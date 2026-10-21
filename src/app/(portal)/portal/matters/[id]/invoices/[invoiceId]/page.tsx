/**
 * One invoice, in the printed-invoice layout. The page prints chrome-free:
 * the portal header/footer and the controls here are `print:hidden`, and
 * "Download PDF" opens the print dialog.
 *
 * InvoicePreview is a server component; with `editable` off it renders
 * static markup only, so the staff-only fields on InvoiceDetail (line-item
 * userId, internal ids) never reach a client component. Only `PrintButton`
 * (no props) is a client component here.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { InvoicePreview } from "@/components/matters/billing/invoice-preview";
import { requirePortalIdentity } from "@/lib/portal-access";
import { getPortalInvoice } from "@/lib/portal/billing";
import { PORTAL_TIME_ZONE } from "@/lib/portal/time-zone";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "./print-button";

export default async function PortalInvoicePage({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  const { identityId } = await requirePortalIdentity();
  const { id, invoiceId } = await params;
  const invoice = await getPortalInvoice(identityId, invoiceId);
  if (!invoice || invoice.matterId !== id) notFound();

  // getCurrentFirm() needs a staff session; the portal has none.
  const firm = await prisma.firm.findFirst();
  if (!firm) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/matters/${id}`}
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-ink-3 outline-none hover:text-brand-700 focus-visible:ring-3 focus-visible:ring-ring/40 print:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back to matter
        </Link>
        <PrintButton />
      </div>
      <div className="overflow-hidden rounded-xl bg-white shadow-xs ring-1 ring-line print:rounded-none print:shadow-none print:ring-0">
        <InvoicePreview
          invoice={invoice}
          firm={firm}
          timeZone={PORTAL_TIME_ZONE}
          printMode
        />
      </div>
    </div>
  );
}
