import { escapeHtml as esc } from "@/lib/email/escape";
import { formatDate } from "@/lib/format-date";
import { portalHomeUrl } from "@/lib/portal/link-url";

export type InvoiceEmailKind = "initial" | "updated" | "resend";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Subject/text/html for an invoice email. The PDF is attached by the caller. */
export function invoiceEmail(input: {
  kind: InvoiceEmailKind;
  invoiceNumber: string;
  firmName: string;
  matterName: string;
  balanceDue: number;
  dueDate: Date;
  timeZone: string;
  portalUrl: string | null;
}): { subject: string; text: string; html: string } {
  const { kind, invoiceNumber, firmName, matterName, portalUrl } = input;
  const subject =
    kind === "updated"
      ? `Updated invoice ${invoiceNumber} from ${firmName}`
      : `Invoice ${invoiceNumber} from ${firmName}`;

  const intro =
    kind === "updated"
      ? `${firmName} has updated invoice ${invoiceNumber} for ${matterName}.`
      : `${firmName} has sent you invoice ${invoiceNumber} for ${matterName}.`;
  const due = formatDate(input.dueDate, "long", input.timeZone);
  const balance =
    input.balanceDue > 0
      ? `Balance due: ${usd.format(input.balanceDue)}, due ${due}.`
      : "This invoice is paid in full. Thank you.";
  const attached = "The invoice is attached as a PDF.";
  const portalLine = "You can also view this invoice in your client portal:";

  const textParts = [intro, balance, attached];
  if (portalUrl) textParts.push(`${portalLine}\n${portalUrl}`);

  const htmlParts = [
    `<p>${esc(intro)}</p>`,
    `<p>${esc(balance)}</p>`,
    `<p>${attached}</p>`,
  ];
  if (portalUrl) {
    htmlParts.push(
      `<p>You can also <a href="${esc(portalUrl)}">view this invoice in your client portal</a>.</p>`
    );
  }

  return {
    subject,
    text: textParts.join("\n\n"),
    html: htmlParts.join(""),
  };
}

export function portalInvoiceUrl(matterId: string, invoiceId: string): string {
  return `${portalHomeUrl()}/matters/${matterId}/invoices/${invoiceId}`;
}
