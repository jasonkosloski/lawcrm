import { describe, expect, it } from "vitest";
import type { FirmProfile } from "@/lib/firm";
import type { InvoiceDetail } from "@/lib/queries/billing";
import { invoicePdfFilename, renderInvoicePdf } from "./invoice-pdf";

const firm: FirmProfile = {
  id: "f1",
  name: "Kosloski Law",
  shortName: "Kosloski",
  ein: null,
  website: null,
  phone: "555-0100",
  email: "billing@kosloskilaw.com",
  addressLine1: "1 Main St",
  addressLine2: null,
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
  establishedAt: null,
  logoUrl: null,
};

const invoice: InvoiceDetail = {
  id: "inv1",
  invoiceNumber: "2026-101",
  issueDate: new Date("2026-10-01T18:00:00Z"),
  dueDate: new Date("2026-10-31T18:00:00Z"),
  daysUntilDue: 10,
  subtotal: 1740.5,
  taxAmount: 100.25,
  totalAmount: 1840.75,
  paidAmount: 500,
  balance: 1340.75,
  status: "partial",
  kind: "client",
  notes: "Thank you for your business.",
  lineItemCount: 2,
  matterId: "m1",
  matterName: "Smith v. Jones",
  clientName: "O'Neil & <Sons>",
  clientEmail: "oneil@example.com",
  clientAddress: { line1: "9 Elm St", city: "Boulder", state: "CO", zip: "80301" },
  lineItems: [
    {
      id: "t1",
      date: new Date("2026-09-10T00:00:00Z"),
      hours: 2.5,
      activity: "Draft complaint",
      narrative: "Drafted and revised",
      rate: 400,
      amount: 1000,
      userId: "u1",
      userName: "Jason Kosloski",
      userJobTitle: "Managing Partner",
      userInitials: "JK",
    },
    {
      id: "t2",
      date: new Date("2026-09-11T00:00:00Z"),
      hours: 1.5,
      activity: "Client call",
      narrative: null,
      rate: 350,
      amount: 525,
      userId: "u1",
      userName: "Jason Kosloski",
      userJobTitle: "Managing Partner",
      userInitials: "JK",
    },
  ],
  expenseLineItems: [
    {
      id: "e1",
      date: new Date("2026-09-12T00:00:00Z"),
      description: "Filing fee",
      category: "court_fees",
      amount: 215.5,
      utbmsCode: null,
      notes: null,
    },
  ],
  payments: [
    {
      id: "p1",
      date: new Date("2026-10-05T00:00:00Z"),
      source: "check",
      description: null,
      reference: "1042",
      amount: 500,
    },
  ],
  paymentsRecordedTotal: 500,
};

async function extractText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(
      content.items.map((it) => ("str" in it ? it.str : "")).join(" ")
    );
  }
  return parts.join("\n");
}

describe("renderInvoicePdf", () => {
  it("renders a PDF containing the invoice's stored figures", async () => {
    const buf = await renderInvoicePdf(invoice, firm, "America/Denver");
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    // Collapse whitespace so words split across text runs still match.
    const text = (await extractText(buf)).replace(/\s+/g, " ");
    for (const s of [
      "2026-101",
      "$1,000.00",
      "$525.00",
      "$215.50",
      "$1,740.50",
      "$100.25",
      "$1,840.75",
      "$500.00",
      "$1,340.75",
      "O'Neil & <Sons>",
      "Kosloski Law",
    ]) {
      expect(text).toContain(s);
    }
  });
});

describe("invoicePdfFilename", () => {
  it("names the file after the invoice number", () => {
    expect(invoicePdfFilename("2026-101")).toBe("Invoice 2026-101.pdf");
  });
});
