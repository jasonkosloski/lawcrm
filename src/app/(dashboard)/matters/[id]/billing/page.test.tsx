/**
 * Matter Billing page — `matters.settlement.view` gate on the
 * Settlement card.
 *
 * The waterfall (gross → firm fee → liens → client net) is the most
 * sensitive number set on a matter, so having billing-tab access is
 * NOT enough to see it — the card renders only for holders of
 * `matters.settlement.view`. These tests pin that gate: without the
 * view key the card is absent even when a settlement exists and even
 * when the user holds edit/approve keys (view is the floor, per
 * docs/PERMISSIONS.md).
 *
 * We do NOT re-test the queries or the card's internals here —
 * `getMatterSettlement` math lives with src/lib/queries/settlements,
 * and the intra-card edit/lien/approve affordances belong to their
 * client components. Only the page's permission plumbing.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/queries/billing", () => ({
  getMatterBilling: vi.fn(),
  getInvoiceById: vi.fn(),
}));
vi.mock("@/lib/queries/settlements", () => ({
  getMatterSettlement: vi.fn(),
}));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "user_1"),
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
  requirePermission: vi.fn(async () => "user_1"),
}));

// Leaf client components — they carry their own hooks / server-action
// wiring. We only care whether the page mounts them, so each becomes
// a testid stub.
// Stubs record the props the page hands them so the tests can assert
// on permission plumbing without rendering the real client components.
const stubProps = vi.hoisted(() => ({
  generate: [] as Array<Record<string, unknown>>,
  bundle: [] as Array<Record<string, unknown>>,
  actionBar: [] as Array<Record<string, unknown>>,
  preview: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/components/matters/billing/bundle-internal-record-form", () => ({
  BundleInternalRecordForm: (p: Record<string, unknown>) => {
    stubProps.bundle.push(p);
    return <div data-testid="bundle-form" />;
  },
}));
vi.mock("@/components/matters/billing/generate-invoice-form", () => ({
  GenerateInvoiceForm: (p: Record<string, unknown>) => {
    stubProps.generate.push(p);
    return <div data-testid="generate-form" />;
  },
}));
vi.mock("@/components/matters/billing/invoice-action-bar", () => ({
  InvoiceActionBar: (p: Record<string, unknown>) => {
    stubProps.actionBar.push(p);
    return <div data-testid="action-bar" />;
  },
}));
vi.mock("@/components/matters/billing/invoice-preview", () => ({
  InvoicePreview: (p: Record<string, unknown>) => {
    stubProps.preview.push(p);
    return <div data-testid="invoice-preview" />;
  },
}));
vi.mock("@/components/matters/billing/trust-transaction-form", () => ({
  TrustTransactionForm: () => <div data-testid="trust-form" />,
}));
vi.mock("@/lib/queries/billing-expenses", () => ({
  getUnbilledExpenseSummary: vi.fn(async () => ({ count: 0, total: 0 })),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/components/matters/settlement/settlement-approvals", () => ({
  SettlementApprovals: () => <div data-testid="settlement-approvals" />,
}));
vi.mock("@/components/matters/settlement/settlement-composer", () => ({
  SettlementComposer: () => <div data-testid="settlement-composer" />,
}));
vi.mock("@/components/matters/settlement/settlement-lien-list", () => ({
  SettlementLienList: ({
    liens,
    canManage,
  }: {
    liens: unknown[];
    canManage: boolean;
  }) => (
    <div
      data-testid="settlement-lien-list"
      data-count={liens.length}
      data-can-manage={String(canManage)}
    />
  ),
}));
vi.mock("@/components/matters/settlement/settlement-lien-form", () => ({
  SettlementLienForm: () => <div data-testid="settlement-lien-form" />,
}));

import { getMatterBilling } from "@/lib/queries/billing";
import { getMatterSettlement } from "@/lib/queries/settlements";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { getInvoiceById } from "@/lib/queries/billing";
import { getUnbilledExpenseSummary } from "@/lib/queries/billing-expenses";
import type {
  InvoiceDetail,
  InvoiceRow,
  MatterBilling,
} from "@/lib/queries/billing";
import type { MatterSettlement } from "@/lib/queries/settlements";
import MatterBillingPage from "./page";

const emptyBilling: MatterBilling = {
  matterId: "m1",
  billingMode: "client",
  wip: {
    hoursTotal: 0,
    amountTotal: 0,
    entryCount: 0,
    expenseCount: 0,
    expenseTotal: 0,
    recent: [],
  },
  trust: { balance: 0, transactions: [] },
  invoices: [],
  outstandingAr: 0,
  receivedPayments: { totalReceived: 0, rows: [] },
};

const settlement: MatterSettlement = {
  id: "settle_1",
  status: "pending",
  grossAmount: 100_000,
  firmFee: 33_333.33,
  firmFeePercent: 33.33,
  advancedCosts: 1_200,
  lienTotal: 0,
  clientNet: 65_466.67,
  liens: [],
  approvals: [],
  createdAt: new Date("2026-06-01"),
  updatedAt: new Date("2026-06-01"),
};

/** Grant exactly these permission keys; everything else denies. */
const grant = (...keys: string[]) =>
  vi
    .mocked(currentUserHasPermission)
    .mockImplementation(async (key) => keys.includes(key));

const renderPage = async (opts?: {
  settlement?: MatterSettlement | null;
  billing?: MatterBilling;
  invoice?: string;
  invoiceDetail?: Partial<InvoiceDetail> | null;
}) => {
  vi.mocked(getMatterBilling).mockResolvedValue(opts?.billing ?? emptyBilling);
  vi.mocked(getMatterSettlement).mockResolvedValue(
    opts?.settlement ?? null
  );
  if (opts?.invoiceDetail !== undefined) {
    vi.mocked(getInvoiceById).mockResolvedValue(
      opts.invoiceDetail as InvoiceDetail | null
    );
  }
  render(
    await MatterBillingPage({
      params: Promise.resolve({ id: "m1" }),
      searchParams: Promise.resolve(opts?.invoice ? { invoice: opts.invoice } : {}),
    } as Parameters<typeof MatterBillingPage>[0])
  );
};

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(getInvoiceById).mockReset();
  vi.mocked(getUnbilledExpenseSummary).mockReset();
  vi.mocked(getUnbilledExpenseSummary).mockResolvedValue({ count: 0, total: 0 });
  for (const list of Object.values(stubProps)) list.length = 0;
});

const invoiceRow = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: "inv1",
  invoiceNumber: "2026-001",
  issueDate: new Date("2026-05-01T04:00:00Z"),
  dueDate: new Date("2026-05-31T04:00:00Z"),
  daysUntilDue: 5,
  subtotal: 400,
  taxAmount: 0,
  totalAmount: 400,
  paidAmount: 0,
  balance: 400,
  status: "sent",
  kind: "client",
  notes: null,
  lineItemCount: 1,
  ...over,
});

describe("MatterBillingPage — matters.settlement.view gate", () => {
  test("settlement exists but user lacks view — card is hidden", async () => {
    grant(); // billing-tab access only, no settlement keys
    await renderPage({ settlement });
    expect(screen.queryByText("Gross settlement")).toBeNull();
    expect(screen.queryByText("Client net")).toBeNull();
  });

  test("edit/approve without view still hides the card (view is the floor)", async () => {
    grant(
      "matters.settlement.edit",
      "matters.settlement.manage_liens",
      "matters.settlement.approve"
    );
    await renderPage({ settlement });
    expect(screen.queryByText("Gross settlement")).toBeNull();
    expect(screen.queryByTestId("settlement-composer")).toBeNull();
  });

  test("view perm + existing settlement — waterfall renders", async () => {
    grant("matters.settlement.view");
    await renderPage({ settlement });
    expect(screen.getByText("Gross settlement")).toBeTruthy();
    expect(screen.getByText("$100,000.00")).toBeTruthy();
    expect(screen.getByText("Client net")).toBeTruthy();
    // Read-only holder: no composer, no lien form.
    expect(screen.queryByTestId("settlement-composer")).toBeNull();
    expect(screen.queryByTestId("settlement-lien-form")).toBeNull();
  });

  test("negative client net renders as a shortfall, not a clean $0.00", async () => {
    grant("matters.settlement.view");
    await renderPage({
      settlement: { ...settlement, lienTotal: 15_000, clientNet: -4_000 },
    });
    expect(screen.getByRole("alert").textContent).toMatch(/\$4,000\.00/);
    expect(screen.getByText("−$4,000.00")).toBeTruthy();
  });

  test("a non-negative net shows no shortfall alert", async () => {
    grant("matters.settlement.view");
    await renderPage({ settlement });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("liens list gets canManage from matters.settlement.manage_liens", async () => {
    grant("matters.settlement.view", "matters.settlement.manage_liens");
    await renderPage({
      settlement: {
        ...settlement,
        liens: [
          {
            id: "l1",
            lienholder: "Denver Health",
            lienholderType: "hospital",
            originalAmount: 5000,
            negotiatedAmount: null,
            effectiveAmount: 5000,
            status: "pending",
          },
        ],
      },
    });
    expect(
      screen.getByTestId("settlement-lien-list").getAttribute("data-can-manage")
    ).toBe("true");
  });

  test("view + edit with no settlement yet — empty-state composer shows", async () => {
    grant("matters.settlement.view", "matters.settlement.edit");
    await renderPage({ settlement: null });
    expect(screen.getByTestId("settlement-composer")).toBeTruthy();
  });

  test("view only with no settlement — nothing to see, card hidden", async () => {
    grant("matters.settlement.view");
    await renderPage({ settlement: null });
    expect(screen.queryByTestId("settlement-composer")).toBeNull();
    expect(screen.queryByText("Gross settlement")).toBeNull();
  });
});

describe("MatterBillingPage — session guard", () => {
  test("without billing.view the page redirects before any query runs", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(
      new Error("NEXT_REDIRECT")
    );
    await expect(
      MatterBillingPage({
        params: Promise.resolve({ id: "m1" }),
        searchParams: Promise.resolve({ invoice: "inv_1" }),
      } as Parameters<typeof MatterBillingPage>[0])
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(getMatterBilling).not.toHaveBeenCalled();
    expect(getInvoiceById).not.toHaveBeenCalled();
    expect(getMatterSettlement).not.toHaveBeenCalled();
    expect(getCurrentFirm).not.toHaveBeenCalled();
    expect(getCurrentUserId).not.toHaveBeenCalled();
    expect(currentUserHasPermission).not.toHaveBeenCalled();
    expect(requirePermission).toHaveBeenCalledWith("billing.view");
  });

  test("a billing.view holder gets the page (guard asked for exactly billing.view)", async () => {
    grant();
    await renderPage();
    expect(requirePermission).toHaveBeenCalledWith("billing.view");
    expect(getMatterBilling).toHaveBeenCalled();
  });
});

const billingWith = (over: Partial<MatterBilling>): MatterBilling => ({
  ...emptyBilling,
  ...over,
});

describe("MatterBillingPage — settlement query is skipped without view (F460)", () => {
  test("no matters.settlement.view: getMatterSettlement is never called", async () => {
    grant("matters.settlement.edit");
    await renderPage({ settlement });
    expect(getMatterSettlement).not.toHaveBeenCalled();
    expect(screen.queryByText("Gross settlement")).toBeNull();
  });

  test("with view: it is called", async () => {
    grant("matters.settlement.view");
    await renderPage({ settlement });
    expect(getMatterSettlement).toHaveBeenCalledWith("m1");
  });
});

describe("MatterBillingPage — mutation controls follow the viewer's keys (F163/F444)", () => {
  const withInvoice = (over: Partial<InvoiceRow> = {}) => {
    const row = invoiceRow(over);
    return {
      billing: billingWith({ invoices: [row] }),
      invoice: row.id,
      invoiceDetail: { ...row, matterId: "m1" } as Partial<InvoiceDetail>,
    };
  };

  test("a viewer with no billing keys sees no generate / bundle / trust controls", async () => {
    grant();
    await renderPage({
      billing: billingWith({
        wip: { hoursTotal: 1, amountTotal: 300, entryCount: 1, expenseCount: 0, expenseTotal: 0, recent: [] },
      }),
    });
    expect(screen.queryByTestId("generate-form")).toBeNull();
    expect(screen.queryByTestId("bundle-form")).toBeNull();
    expect(screen.queryByTestId("trust-form")).toBeNull();
    expect(screen.getByText(/billing\.generate_invoice permission/i)).toBeTruthy();
  });

  test("the keys reveal exactly their controls", async () => {
    grant("billing.generate_invoice", "trust.record_transaction");
    await renderPage({
      billing: billingWith({
        wip: { hoursTotal: 1, amountTotal: 300, entryCount: 1, expenseCount: 0, expenseTotal: 0, recent: [] },
      }),
    });
    expect(screen.getByTestId("generate-form")).toBeTruthy();
    expect(screen.getByTestId("bundle-form")).toBeTruthy();
    expect(screen.getByTestId("trust-form")).toBeTruthy();
  });

  test("the trust form needs trust.record_transaction on its own", async () => {
    grant("billing.generate_invoice");
    await renderPage();
    expect(screen.queryByTestId("trust-form")).toBeNull();
  });

  test("the action bar gets one flag per key, all false without keys", async () => {
    grant();
    await renderPage(withInvoice());
    const props = stubProps.actionBar.at(-1)!;
    expect(props).toMatchObject({
      canApplyTrust: false,
      canApproveInvoice: false,
      canSendInvoice: false,
      canRecordInvoicePayment: false,
      canVoid: false,
      canDeleteDraft: false,
    });
  });

  test("the action bar flags map to their own keys", async () => {
    grant(
      "billing.approve_invoice",
      "billing.record_payment",
      "billing.apply_trust"
    );
    await renderPage(withInvoice());
    expect(stubProps.actionBar.at(-1)).toMatchObject({
      canApproveInvoice: true,
      canSendInvoice: false,
      canRecordInvoicePayment: true,
      canApplyTrust: true,
      canVoid: false,
      canDeleteDraft: false,
    });
    expect(stubProps.preview.at(-1)).toMatchObject({
      timeZone: "America/Denver",
    });
  });

  test("line items are editable only for a draft AND billing.generate_invoice", async () => {
    grant("billing.generate_invoice");
    await renderPage(withInvoice({ status: "draft" }));
    expect(stubProps.preview.at(-1)).toMatchObject({ editable: true });

    stubProps.preview.length = 0;
    await renderPage(withInvoice({ status: "sent" }));
    expect(stubProps.preview.at(-1)).toMatchObject({ editable: false });
  });
});

describe("MatterBillingPage — ?invoice= must belong to this matter", () => {
  test("an invoice id from another matter is ignored (nothing rendered)", async () => {
    grant("billing.approve_invoice");
    const row = invoiceRow();
    await renderPage({
      billing: billingWith({ invoices: [row] }),
      invoice: "inv1",
      invoiceDetail: { ...row, matterId: "other-matter" } as Partial<InvoiceDetail>,
    });
    expect(screen.queryByTestId("invoice-preview")).toBeNull();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  test("an id that is not in this matter's invoice list is ignored", async () => {
    grant();
    await renderPage({
      billing: billingWith({ invoices: [invoiceRow({ id: "inv1" })] }),
      invoice: "inv-unknown",
      invoiceDetail: { ...invoiceRow({ id: "inv-unknown" }), matterId: "m1" },
    });
    expect(screen.queryByTestId("invoice-preview")).toBeNull();
  });
});

describe("MatterBillingPage — WIP includes billable expenses (F165)", () => {
  test("the KPI and card count time + expenses and the forms get both", async () => {
    grant("billing.generate_invoice");
    vi.mocked(getUnbilledExpenseSummary).mockResolvedValue({
      count: 2,
      total: 402.5,
    });
    await renderPage({
      billing: billingWith({
        wip: { hoursTotal: 2, amountTotal: 600, entryCount: 3, expenseCount: 0, expenseTotal: 0, recent: [] },
      }),
    });
    expect(screen.getByText("$1,002.50")).toBeTruthy();
    expect(screen.getByText(/2\.0 h · 3 entries · 2 expenses/)).toBeTruthy();
    expect(stubProps.generate.at(-1)).toMatchObject({
      amountTotal: 600,
      entryCount: 3,
      expenseTotal: 402.5,
      expenseCount: 2,
    });
    expect(stubProps.bundle.at(-1)).toMatchObject({
      expenseTotal: 402.5,
      expenseCount: 2,
    });
  });

  test("an expenses-only matter still offers the generate form", async () => {
    grant("billing.generate_invoice");
    vi.mocked(getUnbilledExpenseSummary).mockResolvedValue({
      count: 1,
      total: 90,
    });
    await renderPage();
    expect(screen.getByTestId("generate-form")).toBeTruthy();
    expect(screen.getByText("$90.00")).toBeTruthy();
  });
});

describe("MatterBillingPage — voided invoices (F466)", () => {
  test("the table shows a dash, not the stored balance, for a void invoice", async () => {
    grant();
    await renderPage({
      billing: billingWith({
        invoices: [
          invoiceRow({
            id: "v1",
            invoiceNumber: "2026-009",
            status: "void",
            totalAmount: 4000,
            balance: 4000,
          }),
        ],
      }),
    });
    const cells = screen.getByText("2026-009").closest("tr")!.textContent!;
    // The total shows once; the Balance column does not repeat it.
    expect(cells.match(/\$4,000\.00/g)?.length).toBe(1);
    expect(cells).toContain("—");
  });

  test("issue / due instants display in the viewer's zone", async () => {
    grant();
    await renderPage({
      billing: billingWith({ invoices: [invoiceRow({ invoiceNumber: "2026-010" })] }),
    });
    const row = screen.getByText("2026-010").closest("tr")!.textContent!;
    // 04:00Z on May 1 is Apr 30, 10 PM in Denver.
    expect(row).toContain("Apr 30, 2026");
    expect(row).toContain("May 30, 2026");
  });
});

describe("MatterBillingPage — lien form on a locked settlement (F881)", () => {
  test.each(["disbursed", "closed"])(
    "no lien form once the settlement is %s",
    async (status) => {
      grant("matters.settlement.view", "matters.settlement.manage_liens");
      await renderPage({ settlement: { ...settlement, status } });
      expect(screen.queryByTestId("settlement-lien-form")).toBeNull();
    }
  );

  test("an open settlement still offers it to a lien manager", async () => {
    grant("matters.settlement.view", "matters.settlement.manage_liens");
    await renderPage({ settlement });
    expect(screen.getByTestId("settlement-lien-form")).toBeTruthy();
  });
});
