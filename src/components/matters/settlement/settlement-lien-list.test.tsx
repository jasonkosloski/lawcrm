/**
 * Tests for SettlementLienList — the per-row lien edit / delete UI
 * (F117: updateSettlementLien and deleteSettlementLien had no caller).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/settlements", () => ({
  updateSettlementLien: vi.fn(),
  deleteSettlementLien: vi.fn(),
}));

import {
  deleteSettlementLien,
  updateSettlementLien,
} from "@/app/actions/settlements";
import { SettlementLienList, type SettlementLienListRow } from "./settlement-lien-list";

const LIENS: SettlementLienListRow[] = [
  {
    id: "l1",
    lienholder: "Denver Health",
    lienholderType: "hospital",
    originalAmount: 5000,
    negotiatedAmount: 2500,
    effectiveAmount: 2500,
    status: "negotiating",
  },
  {
    id: "l2",
    lienholder: "Aetna",
    lienholderType: null,
    originalAmount: 1000,
    negotiatedAmount: null,
    effectiveAmount: 1000,
    status: "pending",
  },
];

// happy-dom doesn't implement confirm — stub it as a global.
const confirmMock = vi.fn();

beforeEach(() => {
  vi.mocked(updateSettlementLien).mockReset();
  vi.mocked(deleteSettlementLien).mockReset();
  // Fresh object per call, like a real server action response.
  vi.mocked(updateSettlementLien).mockImplementation(async () => ({
    status: "ok",
  }));
  vi.mocked(deleteSettlementLien).mockResolvedValue({ ok: true });
  confirmMock.mockReset();
  vi.stubGlobal("confirm", confirmMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettlementLienList — display", () => {
  test("renders nothing when there are no liens", () => {
    const { container } = render(
      <SettlementLienList liens={[]} canManage locked={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  test("shows the effective amount, a struck-through original when negotiated down, and labels", () => {
    render(<SettlementLienList liens={LIENS} canManage={false} locked={false} />);
    expect(screen.getByText("Denver Health")).toBeInTheDocument();
    expect(screen.getByText("$2,500.00")).toBeInTheDocument();
    expect(screen.getByText("$5,000.00")).toBeInTheDocument(); // struck original
    expect(screen.getByText(/Hospital · Negotiating/)).toBeInTheDocument();
    expect(screen.getByText(/— · Pending/)).toBeInTheDocument();
  });

  test("no controls without manage_liens", () => {
    render(<SettlementLienList liens={LIENS} canManage={false} locked={false} />);
    expect(screen.queryByRole("button", { name: /edit lien/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove lien/i })).toBeNull();
  });

  test("no controls once the settlement is disbursed/closed", () => {
    render(<SettlementLienList liens={LIENS} canManage locked />);
    expect(screen.queryByRole("button", { name: /edit lien/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove lien/i })).toBeNull();
  });
});

describe("SettlementLienList — edit", () => {
  test("opens seeded with the negotiated amount and status, and saves via updateSettlementLien", async () => {
    const user = userEvent.setup();
    render(<SettlementLienList liens={LIENS} canManage locked={false} />);
    await user.click(screen.getByRole("button", { name: "Edit lien Denver Health" }));

    const amount = screen.getByLabelText(/negotiated amount/i) as HTMLInputElement;
    expect(amount.value).toBe("2500.00");
    expect((screen.getByLabelText(/^status/i) as HTMLSelectElement).value).toBe(
      "negotiating"
    );

    await user.clear(amount);
    await user.type(amount, "1800");
    await user.selectOptions(screen.getByLabelText(/^status/i), "signed");
    await user.click(screen.getByRole("button", { name: /save lien/i }));

    await waitFor(() => expect(updateSettlementLien).toHaveBeenCalledTimes(1));
    const fd = vi.mocked(updateSettlementLien).mock.calls[0]![2] as FormData;
    expect(fd.get("negotiatedAmount")).toBe("1800");
    expect(fd.get("status")).toBe("signed");
    // The bound lien id is the first argument.
    expect(vi.mocked(updateSettlementLien).mock.calls[0]![0]).toBe("l1");

    // Closes on success.
    await waitFor(() =>
      expect(screen.queryByLabelText(/negotiated amount/i)).toBeNull()
    );
  });

  test("a lien with no negotiated amount opens blank (saving does not set 0)", async () => {
    const user = userEvent.setup();
    render(<SettlementLienList liens={LIENS} canManage locked={false} />);
    await user.click(screen.getByRole("button", { name: "Edit lien Aetna" }));
    expect((screen.getByLabelText(/negotiated amount/i) as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: /save lien/i }));
    await waitFor(() => expect(updateSettlementLien).toHaveBeenCalled());
    const fd = vi.mocked(updateSettlementLien).mock.calls[0]![2] as FormData;
    expect(fd.get("negotiatedAmount")).toBe("");
  });

  test("server errors show inline and the editor stays open with the typed value", async () => {
    vi.mocked(updateSettlementLien).mockResolvedValueOnce({
      status: "error",
      errors: { negotiatedAmount: ["Enter a valid amount"] },
    });
    const user = userEvent.setup();
    render(<SettlementLienList liens={LIENS} canManage locked={false} />);
    await user.click(screen.getByRole("button", { name: "Edit lien Aetna" }));
    await user.type(screen.getByLabelText(/negotiated amount/i), "12.345");
    await user.click(screen.getByRole("button", { name: /save lien/i }));
    expect(await screen.findByText("Enter a valid amount")).toBeInTheDocument();
    expect((screen.getByLabelText(/negotiated amount/i) as HTMLInputElement).value).toBe(
      "12.345"
    );
  });

  test("cancel discards the draft; reopening starts from server values", async () => {
    const user = userEvent.setup();
    render(<SettlementLienList liens={LIENS} canManage locked={false} />);
    await user.click(screen.getByRole("button", { name: "Edit lien Denver Health" }));
    await user.clear(screen.getByLabelText(/negotiated amount/i));
    await user.type(screen.getByLabelText(/negotiated amount/i), "1");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByLabelText(/negotiated amount/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit lien Denver Health" }));
    expect((screen.getByLabelText(/negotiated amount/i) as HTMLInputElement).value).toBe(
      "2500.00"
    );
  });
});

describe("SettlementLienList — delete", () => {
  test("confirm -> deleteSettlementLien with the lien id", async () => {
    confirmMock.mockReturnValue(true);
    const user = userEvent.setup();
    render(<SettlementLienList liens={LIENS} canManage locked={false} />);
    await user.click(screen.getByRole("button", { name: "Remove lien Aetna" }));
    await waitFor(() => expect(deleteSettlementLien).toHaveBeenCalledWith("l2"));
  });

  test("declining the confirm does nothing", async () => {
    confirmMock.mockReturnValue(false);
    const user = userEvent.setup();
    render(<SettlementLienList liens={LIENS} canManage locked={false} />);
    await user.click(screen.getByRole("button", { name: "Remove lien Aetna" }));
    expect(deleteSettlementLien).not.toHaveBeenCalled();
  });

  test("a server refusal is shown on the row", async () => {
    confirmMock.mockReturnValue(true);
    vi.mocked(deleteSettlementLien).mockResolvedValueOnce({
      ok: false,
      error: "Settlement is closed — can't remove liens after disbursement.",
    });
    const user = userEvent.setup();
    render(<SettlementLienList liens={LIENS} canManage locked={false} />);
    await user.click(screen.getByRole("button", { name: "Remove lien Aetna" }));
    expect(await screen.findByText(/can't remove liens after disbursement/)).toBeInTheDocument();
  });
});
