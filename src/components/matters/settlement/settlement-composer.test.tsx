/**
 * Tests for SettlementComposer.
 *
 * What's worth pinning down:
 *   - The hidden firmFee input round-trips the stored explicit fee
 *     when the settlement is explicit-fee driven (percent null) —
 *     submitting "" there would zero the fee on save.
 *   - Percent-driven settlements keep submitting "" so the action's
 *     recompute-from-percent path stays authoritative.
 *   - New settlements (initial null) submit "" too.
 *   - Permission gating: no canEdit + no settlement → hint text;
 *     no canEdit + settlement → renders nothing (read view lives
 *     in SettlementCard).
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/settlements", () => ({
  upsertSettlement: vi.fn(),
}));

import { SettlementComposer } from "./settlement-composer";

const EXPLICIT_FEE_INITIAL = {
  grossAmount: 90000,
  firmFeePercent: null,
  firmFee: 27500.5,
  advancedCosts: 1200,
  status: "pending",
};

const PERCENT_INITIAL = {
  grossAmount: 90000,
  firmFeePercent: 33.33,
  firmFee: 29997, // stored computed value — percent is the source of truth
  advancedCosts: 1200,
  status: "pending",
};

/** Existing settlements render compact; expand to reach the form. */
async function expandForm() {
  await userEvent.click(
    screen.getByRole("button", { name: /edit gross \/ fee \/ costs \/ status/i })
  );
}

function hiddenFirmFee(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[name="firmFee"]'
  );
  expect(input).not.toBeNull();
  return input!;
}

describe("SettlementComposer — hidden firmFee round-trip", () => {
  test("explicit-fee settlement (percent null) round-trips the stored fee", async () => {
    const { container } = render(
      <SettlementComposer
        matterId="m1"
        initial={EXPLICIT_FEE_INITIAL}
        canEdit
      />
    );
    await expandForm();
    expect(hiddenFirmFee(container).value).toBe("27500.50");
  });

  test("percent-driven settlement submits '' so the action recomputes from percent", async () => {
    const { container } = render(
      <SettlementComposer matterId="m1" initial={PERCENT_INITIAL} canEdit />
    );
    await expandForm();
    expect(hiddenFirmFee(container).value).toBe("");
  });

  test("new settlement (initial null) submits ''", () => {
    const { container } = render(
      <SettlementComposer matterId="m1" initial={null} canEdit />
    );
    // No existing settlement → form renders expanded immediately.
    expect(hiddenFirmFee(container).value).toBe("");
  });
});

describe("SettlementComposer — permission gating", () => {
  test("no canEdit + no settlement shows the permission hint", () => {
    render(<SettlementComposer matterId="m1" initial={null} canEdit={false} />);
    expect(
      screen.getByText(/Settlement\.edit permission required/i)
    ).toBeInTheDocument();
  });

  test("no canEdit + existing settlement renders nothing (read view is elsewhere)", () => {
    const { container } = render(
      <SettlementComposer
        matterId="m1"
        initial={PERCENT_INITIAL}
        canEdit={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
