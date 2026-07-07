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
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));

// Leaf client components — they carry their own hooks / server-action
// wiring. We only care whether the page mounts them, so each becomes
// a testid stub.
vi.mock("@/components/matters/billing/bundle-internal-record-form", () => ({
  BundleInternalRecordForm: () => null,
}));
vi.mock("@/components/matters/billing/generate-invoice-form", () => ({
  GenerateInvoiceForm: () => null,
}));
vi.mock("@/components/matters/billing/invoice-action-bar", () => ({
  InvoiceActionBar: () => null,
}));
vi.mock("@/components/matters/billing/invoice-preview", () => ({
  InvoicePreview: () => null,
}));
vi.mock("@/components/matters/billing/trust-transaction-form", () => ({
  TrustTransactionForm: () => null,
}));
vi.mock("@/components/matters/settlement/settlement-approvals", () => ({
  SettlementApprovals: () => <div data-testid="settlement-approvals" />,
}));
vi.mock("@/components/matters/settlement/settlement-composer", () => ({
  SettlementComposer: () => <div data-testid="settlement-composer" />,
}));
vi.mock("@/components/matters/settlement/settlement-lien-form", () => ({
  SettlementLienForm: () => <div data-testid="settlement-lien-form" />,
}));

import { getMatterBilling } from "@/lib/queries/billing";
import { getMatterSettlement } from "@/lib/queries/settlements";
import { currentUserHasPermission } from "@/lib/permission-check";
import type { MatterBilling } from "@/lib/queries/billing";
import type { MatterSettlement } from "@/lib/queries/settlements";
import MatterBillingPage from "./page";

const emptyBilling: MatterBilling = {
  matterId: "m1",
  billingMode: "client",
  wip: { hoursTotal: 0, amountTotal: 0, entryCount: 0, recent: [] },
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

const renderPage = async (opts?: { settlement?: MatterSettlement | null }) => {
  vi.mocked(getMatterBilling).mockResolvedValue(emptyBilling);
  vi.mocked(getMatterSettlement).mockResolvedValue(
    opts?.settlement ?? null
  );
  render(
    await MatterBillingPage({
      params: Promise.resolve({ id: "m1" }),
      searchParams: Promise.resolve({}),
    } as Parameters<typeof MatterBillingPage>[0])
  );
};

afterEach(() => {
  vi.clearAllMocks();
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
