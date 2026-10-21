import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDate } from "@/lib/format-date";
import { invoiceEmail, invoiceVoidEmail, portalInvoiceUrl } from "./invoice-email";

const base = {
  kind: "initial" as const,
  invoiceNumber: "2026-101",
  firmName: "Kosloski Law",
  matterName: "Smith v. Jones",
  balanceDue: 1234.5,
  dueDate: new Date("2026-11-15T19:00:00Z"),
  timeZone: "America/Denver",
  portalUrl: null as string | null,
};

afterEach(() => vi.unstubAllEnvs());

describe("invoiceEmail", () => {
  it("builds subjects by kind", () => {
    expect(invoiceEmail(base).subject).toBe("Invoice 2026-101 from Kosloski Law");
    expect(invoiceEmail({ ...base, kind: "resend" }).subject).toBe(
      "Invoice 2026-101 from Kosloski Law"
    );
    expect(invoiceEmail({ ...base, kind: "updated" }).subject).toBe(
      "Updated invoice 2026-101 from Kosloski Law"
    );
  });

  it("states balance, due date and attachment", () => {
    const { text } = invoiceEmail(base);
    expect(text).toContain("$1,234.50");
    expect(text).toContain(formatDate(base.dueDate, "long", "America/Denver"));
    expect(text).toContain("The invoice is attached as a PDF.");
  });

  it("says paid in full at zero balance", () => {
    const { text, html } = invoiceEmail({ ...base, balanceDue: 0 });
    expect(text).toContain("This invoice is paid in full. Thank you.");
    expect(text).not.toContain("$0.00");
    expect(html).not.toContain("$0.00");
  });

  it("includes the portal link only when given", () => {
    const url = "https://portal.litgox.com/matters/m1/invoices/i1";
    const on = invoiceEmail({ ...base, portalUrl: url });
    for (const body of [on.text, on.html]) {
      expect(body).toContain(url);
      expect(body).toContain("view this invoice in your client portal");
    }
    const off = invoiceEmail(base);
    for (const body of [off.text, off.html]) {
      expect(body).not.toContain("https://portal");
      expect(body).not.toContain("view this invoice in your client portal");
    }
  });

  it("escapes dynamic html", () => {
    const { html } = invoiceEmail({ ...base, matterName: "<b>A&B</b>" });
    expect(html).toContain("&lt;b&gt;A&amp;B&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("portalInvoiceUrl", () => {
  it("builds the portal invoice url", () => {
    vi.stubEnv("PORTAL_HOST", "portal.litgox.com");
    expect(portalInvoiceUrl("m1", "i1")).toBe(
      "https://portal.litgox.com/matters/m1/invoices/i1"
    );
  });
});

describe("invoiceVoidEmail", () => {
  it("says the invoice is voided and a VOID copy is attached", () => {
    const e = invoiceVoidEmail({
      invoiceNumber: "2026-101",
      firmName: "Kosloski Law",
      matterName: "Smith v. Jones",
    });
    expect(e.subject).toBe("Invoice 2026-101 from Kosloski Law has been voided");
    expect(e.text).toContain("has been voided and no payment is due on it");
    expect(e.text).toContain("A copy marked VOID is attached for your records.");
  });

  it("escapes html", () => {
    const e = invoiceVoidEmail({
      invoiceNumber: "1",
      firmName: "F",
      matterName: "<b>A&B</b>",
    });
    expect(e.html).toContain("&lt;b&gt;A&amp;B&lt;/b&gt;");
    expect(e.html).not.toContain("<b>");
  });
});
