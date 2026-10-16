/**
 * Tests for InvoiceActionBar's trust affordances: Apply-trust (and
 * the Trust payment method behind Record payment) only appear for
 * viewers holding billing.apply_trust. The server enforces the same
 * key; this keeps the UI from offering a button that would bounce.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/actions/billing", () => ({
  approveInvoice: vi.fn(),
  deleteInvoice: vi.fn(),
  setInvoiceStatus: vi.fn(),
  recordInvoicePayment: vi.fn(),
  sendInvoice: vi.fn(),
}));

import { InvoiceActionBar } from "./invoice-action-bar";

const baseProps = {
  invoiceId: "inv1",
  invoiceNumber: "2026-001",
  currentStatus: "sent",
  invoiceBalance: 300,
  trustBalance: 1000,
  paidAmount: 0,
  clientEmail: "c@example.com",
};

describe("InvoiceActionBar — Apply trust visibility", () => {
  test("hidden without billing.apply_trust (Record payment still offered)", () => {
    render(<InvoiceActionBar {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /apply trust/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /record payment/i })
    ).toBeInTheDocument();
  });

  test("shown with billing.apply_trust when there is trust and an open balance", () => {
    render(<InvoiceActionBar {...baseProps} canApplyTrust />);
    expect(
      screen.getByRole("button", { name: /apply trust/i })
    ).toBeInTheDocument();
  });

  test("hidden even with the key when the matter has no trust funds", () => {
    render(<InvoiceActionBar {...baseProps} trustBalance={0} canApplyTrust />);
    expect(
      screen.queryByRole("button", { name: /apply trust/i })
    ).not.toBeInTheDocument();
  });
});
