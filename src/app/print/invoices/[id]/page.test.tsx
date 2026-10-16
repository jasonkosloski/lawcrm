/**
 * Print Invoice route — session guard.
 *
 * The route sits outside the (dashboard) layout, so the page must
 * authenticate itself. These tests pin that an unauthenticated
 * request is redirected before the invoice (or firm) is read, and
 * that a signed-in request for a missing invoice 404s. Letterhead
 * rendering belongs to InvoicePreview and is not re-tested here.
 */

import { describe, expect, test, vi, afterEach } from "vitest";

vi.mock("@/lib/queries/billing", () => ({ getInvoiceById: vi.fn() }));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/components/matters/billing/invoice-preview", () => ({
  InvoicePreview: () => null,
}));
vi.mock("@/components/matters/billing/print-toolbar", () => ({
  PrintToolbar: () => null,
}));

import { getInvoiceById } from "@/lib/queries/billing";
import { getCurrentFirm } from "@/lib/firm";
import { requireUser } from "@/lib/current-user";
import PrintInvoicePage from "./page";

const props = {
  params: Promise.resolve({ id: "inv_1" }),
  searchParams: Promise.resolve({}),
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("PrintInvoicePage — session guard", () => {
  test("unauthenticated: requireUser redirects before any query runs", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(PrintInvoicePage(props)).rejects.toThrow("NEXT_REDIRECT");
    expect(getInvoiceById).not.toHaveBeenCalled();
    expect(getCurrentFirm).not.toHaveBeenCalled();
  });

  test("authenticated but unknown invoice id: 404s", async () => {
    vi.mocked(getInvoiceById).mockResolvedValue(null);
    await expect(PrintInvoicePage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(getInvoiceById).toHaveBeenCalledWith("inv_1");
  });
});
