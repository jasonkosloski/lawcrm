/**
 * Print invoice route.
 *
 *  - Permission guard: when `requirePermission("billing.view")` redirects, the page and
 *    `generateMetadata` reject before any invoice / firm / zone read.
 *  - 404 for a missing invoice.
 *  - Document title "Invoice <number>" (the Save-as-PDF filename) and
 *    noindex; a generic title when the invoice is missing.
 *  - The preview is rendered in print mode with the viewer's zone.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/queries/billing", () => ({ getInvoiceById: vi.fn() }));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({ getCurrentUserTimeZone: vi.fn() }));
vi.mock("@/components/matters/billing/print-toolbar", () => ({
  PrintToolbar: () => null,
}));
vi.mock("@/components/matters/billing/invoice-preview", () => ({
  InvoicePreview: () => null,
}));

import { getInvoiceById } from "@/lib/queries/billing";
import { getCurrentFirm } from "@/lib/firm";
import { requirePermission } from "@/lib/permission-check";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import PrintInvoicePage, { generateMetadata } from "./page";

const params = Promise.resolve({ id: "inv_1" });
const searchParams = Promise.resolve({ autoprint: "1" });

beforeEach(() => {
  vi.mocked(requirePermission).mockReset().mockResolvedValue("user_1");
  vi.mocked(getInvoiceById).mockReset();
  vi.mocked(getCurrentFirm).mockReset().mockResolvedValue({} as never);
  vi.mocked(getCurrentUserTimeZone)
    .mockReset()
    .mockResolvedValue("America/Denver");
});

describe("print invoice page — permission guard", () => {
  test("without billing.view: the guard redirects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(
      PrintInvoicePage({ params, searchParams })
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(getInvoiceById).not.toHaveBeenCalled();
    expect(getCurrentFirm).not.toHaveBeenCalled();
    expect(getCurrentUserTimeZone).not.toHaveBeenCalled();
    expect(requirePermission).toHaveBeenCalledWith("billing.view");
  });

  test("generateMetadata is gated by billing.view before reading the invoice", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(generateMetadata({ params })).rejects.toThrow("NEXT_REDIRECT");
    expect(getInvoiceById).not.toHaveBeenCalled();
  });
});

describe("print invoice page — behaviour", () => {
  test("a missing invoice 404s", async () => {
    vi.mocked(getInvoiceById).mockResolvedValue(null);
    await expect(
      PrintInvoicePage({ params, searchParams })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("renders the preview in print mode with the viewer's zone", async () => {
    vi.mocked(getInvoiceById).mockResolvedValue({
      id: "inv_1",
      invoiceNumber: "2026-007",
    } as never);
    const tree = (await PrintInvoicePage({ params, searchParams })) as {
      props: { children: unknown };
    };
    const json = JSON.stringify(tree, (_k, v) =>
      typeof v === "function" ? "fn" : v
    );
    expect(json).toContain('"printMode":true');
    expect(json).toContain('"timeZone":"America/Denver"');
    expect(json).toContain('"autoprint":true');
  });

  test("the document title names the invoice (Save-as-PDF filename) and is noindex", async () => {
    vi.mocked(getInvoiceById).mockResolvedValue({
      id: "inv_1",
      invoiceNumber: "2026-007",
    } as never);
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe("Invoice 2026-007");
    expect(meta.robots).toMatchObject({ index: false });
  });

  test("a missing invoice gets a generic title, not an error", async () => {
    vi.mocked(getInvoiceById).mockResolvedValue(null);
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe("Invoice");
  });
});
