/**
 * Tests for SettlementLienForm (the add-lien composer).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/settlements", () => ({
  addSettlementLien: vi.fn(),
}));

import { addSettlementLien } from "@/app/actions/settlements";
import { LIENHOLDER_TYPES } from "@/lib/settlement-constants";
import { SettlementLienForm } from "./settlement-lien-form";

beforeEach(() => {
  vi.mocked(addSettlementLien).mockReset();
  vi.mocked(addSettlementLien).mockImplementation(async () => ({ status: "ok" as const }));
});

const open = async () => {
  render(<SettlementLienForm settlementId="s1" />);
  await userEvent.click(screen.getByRole("button", { name: /add lien/i }));
};

describe("SettlementLienForm", () => {
  test("fields are reachable by label; type options come from the shared list", async () => {
    await open();
    expect(screen.getByLabelText(/^lienholder/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^original amount/i)).toBeInTheDocument();
    const type = screen.getByLabelText(/^type/i) as HTMLSelectElement;
    expect(Array.from(type.options).map((o) => o.value)).toEqual(["", ...LIENHOLDER_TYPES]);
  });

  test("validation errors render as text under the field (F891)", async () => {
    vi.mocked(addSettlementLien).mockResolvedValueOnce({
      status: "error",
      errors: {
        lienholder: ["Lienholder is required"],
        originalAmount: ["Enter a valid amount"],
      },
    });
    await open();
    await userEvent.type(screen.getByLabelText(/^lienholder/i), "X");
    await userEvent.type(screen.getByLabelText(/^original amount/i), "12.345");
    await userEvent.click(screen.getByRole("button", { name: /^add lien$/i }));
    expect(await screen.findByText("Enter a valid amount")).toBeInTheDocument();
    expect(screen.getByText("Lienholder is required")).toBeInTheDocument();
    // Typed values survive the failed submit.
    expect((screen.getByLabelText(/^original amount/i) as HTMLInputElement).value).toBe("12.345");
  });

  test("a successful add collapses and resets, twice in a row", async () => {
    render(<SettlementLienForm settlementId="s1" />);
    for (const lienholder of ["Aetna", "Medicare"]) {
      await userEvent.click(screen.getByRole("button", { name: /add lien/i }));
      expect((screen.getByLabelText(/^lienholder/i) as HTMLInputElement).value).toBe("");
      await userEvent.type(screen.getByLabelText(/^lienholder/i), lienholder);
      await userEvent.type(screen.getByLabelText(/^original amount/i), "100");
      await userEvent.click(screen.getByRole("button", { name: /^add lien$/i }));
      await waitFor(() => expect(screen.queryByLabelText(/^lienholder/i)).toBeNull());
    }
    expect(addSettlementLien).toHaveBeenCalledTimes(2);
  });
});
