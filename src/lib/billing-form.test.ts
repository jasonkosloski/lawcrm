/**
 * Tests for the billing state-machine helpers.
 *
 * The state machine is the single most important invariant in the
 * billing system — every UI action gates on transitions, every
 * server action verifies them. A regression here would be a real
 * accounting bug.
 */

import { describe, expect, test } from "vitest";
import {
  canDeleteInvoice,
  canVoidInvoice,
  invoiceStatusLabel,
  invoiceStatusTransitions,
} from "./billing-form";

describe("invoiceStatusTransitions — client invoice flow", () => {
  test("draft → approved only (drafts are deletable, not voidable)", () => {
    expect(invoiceStatusTransitions("draft", "client")).toEqual(["approved"]);
  });

  test("approved → sent or void", () => {
    expect(invoiceStatusTransitions("approved", "client")).toEqual([
      "sent",
      "void",
    ]);
  });

  test("sent → partial / paid / void", () => {
    expect(invoiceStatusTransitions("sent", "client")).toEqual([
      "partial",
      "paid",
      "void",
    ]);
  });

  test("partial → paid (no void once payments exist)", () => {
    expect(invoiceStatusTransitions("partial", "client")).toEqual(["paid"]);
  });

  test("paid + void are terminal", () => {
    expect(invoiceStatusTransitions("paid", "client")).toEqual([]);
    expect(invoiceStatusTransitions("void", "client")).toEqual([]);
  });

  test("unknown status → empty (defensive default)", () => {
    expect(invoiceStatusTransitions("garbage", "client")).toEqual([]);
  });
});

describe("invoiceStatusTransitions — internal record flow", () => {
  test("draft → paid or void; paid → void", () => {
    expect(invoiceStatusTransitions("draft", "internal_record")).toEqual([
      "paid",
      "void",
    ]);
    expect(invoiceStatusTransitions("paid", "internal_record")).toEqual([
      "void",
    ]);
  });

  test("internal records skip 'sent' entirely (no AR meaning)", () => {
    expect(
      invoiceStatusTransitions("draft", "internal_record")
    ).not.toContain("sent");
  });
});

describe("canVoidInvoice", () => {
  test("client invoice in approved/sent with no payments → voidable", () => {
    expect(canVoidInvoice("approved", 0, "client")).toBe(true);
    expect(canVoidInvoice("sent", 0, "client")).toBe(true);
  });

  test("any paidAmount > 0 blocks void on client invoices", () => {
    // Even tiny payment amounts should block — once money is real,
    // the row carries audit weight.
    expect(canVoidInvoice("sent", 0.01, "client")).toBe(false);
    expect(canVoidInvoice("partial", 100, "client")).toBe(false);
    expect(canVoidInvoice("paid", 100, "client")).toBe(false);
  });

  test("draft is NOT voidable on client (drafts use Delete)", () => {
    expect(canVoidInvoice("draft", 0, "client")).toBe(false);
  });

  test("internal records ignore the payment guard", () => {
    // Internal records carry no AR — the payment-amount check
    // doesn't apply. Voidability is purely state-machine driven.
    expect(canVoidInvoice("draft", 0, "internal_record")).toBe(true);
    expect(canVoidInvoice("paid", 9999, "internal_record")).toBe(true);
  });
});

describe("canDeleteInvoice", () => {
  test("only draft client invoices are deletable", () => {
    expect(canDeleteInvoice("draft", 0, "client")).toBe(true);
  });

  test("any non-draft client status refuses delete", () => {
    expect(canDeleteInvoice("approved", 0, "client")).toBe(false);
    expect(canDeleteInvoice("sent", 0, "client")).toBe(false);
    expect(canDeleteInvoice("partial", 0, "client")).toBe(false);
    expect(canDeleteInvoice("paid", 0, "client")).toBe(false);
    expect(canDeleteInvoice("void", 0, "client")).toBe(false);
  });

  test("draft with payments somehow recorded is NOT deletable", () => {
    // Defensive — drafts shouldn't have payments, but if data
    // drifted, the delete shouldn't silently nuke them.
    expect(canDeleteInvoice("draft", 100, "client")).toBe(false);
  });

  test("internal records are never deletable (use void)", () => {
    expect(canDeleteInvoice("draft", 0, "internal_record")).toBe(false);
    expect(canDeleteInvoice("paid", 0, "internal_record")).toBe(false);
  });
});

describe("invoiceStatusLabel — kind-aware display", () => {
  test("client invoices use AR labels", () => {
    expect(invoiceStatusLabel("draft", "client")).toBe("Draft");
    expect(invoiceStatusLabel("approved", "client")).toBe("Approved");
    expect(invoiceStatusLabel("sent", "client")).toBe("Sent");
    expect(invoiceStatusLabel("partial", "client")).toBe("Partially paid");
    expect(invoiceStatusLabel("paid", "client")).toBe("Paid");
    expect(invoiceStatusLabel("void", "client")).toBe("Void");
  });

  test("internal records relabel 'paid' to 'Recorded'", () => {
    // 'paid' on an internal record means "bundled and locked,"
    // not "money received." The relabel keeps the UI honest.
    expect(invoiceStatusLabel("paid", "internal_record")).toBe("Recorded");
    expect(invoiceStatusLabel("draft", "internal_record")).toBe("Draft");
    expect(invoiceStatusLabel("void", "internal_record")).toBe("Void");
  });

  test("unknown statuses fall through to the raw key", () => {
    expect(invoiceStatusLabel("garbage", "client")).toBe("garbage");
  });
});
