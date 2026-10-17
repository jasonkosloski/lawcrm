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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/settlements", () => ({
  upsertSettlement: vi.fn(),
}));

import { upsertSettlement } from "@/app/actions/settlements";
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

describe("SettlementComposer — status rules + re-seed (F115 / F116)", () => {
  const statusSelect = () =>
    screen.getByRole("combobox") as HTMLSelectElement;
  const optionValues = () =>
    Array.from(statusSelect().options).map((o) => o.value);

  test("a new settlement offers no status choice — it posts 'pending'", () => {
    const { container } = render(
      <SettlementComposer matterId="m1" initial={null} canEdit />
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    const hidden = container.querySelector<HTMLInputElement>(
      'input[name="status"]'
    );
    expect(hidden?.value).toBe("pending");
  });

  test("existing settlement only offers the current status, reopen and the next stage", async () => {
    render(
      <SettlementComposer
        matterId="m1"
        initial={{ ...PERCENT_INITIAL, status: "approved" }}
        canEdit
      />
    );
    await expandForm();
    expect(optionValues()).toEqual(["approved", "pending", "disbursed"]);
  });

  test("without the approve permission the status is read-only and posts unchanged", async () => {
    const { container } = render(
      <SettlementComposer
        matterId="m1"
        initial={{ ...PERCENT_INITIAL, status: "approved" }}
        canEdit
        canApprove={false}
      />
    );
    await expandForm();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('input[name="status"]')?.value
    ).toBe("approved");
    // The read-only value is not a labelable control, so its label is
    // plain text and not a <label for> pointing at nothing.
    expect(container.querySelector('label[for$="-status"]')).toBeNull();
    expect(screen.getByText(/^status/i)).toBeInTheDocument();
  });

  test("re-seeds from the server copy when it changes (auto-promotion must not be posted back as 'pending')", async () => {
    const { container, rerender } = render(
      <SettlementComposer matterId="m1" initial={PERCENT_INITIAL} canEdit />
    );
    await expandForm();
    expect(statusSelect().value).toBe("pending");

    // All steps approved on the same card -> server promotes the
    // settlement; the page re-renders the composer with new props.
    rerender(
      <SettlementComposer
        matterId="m1"
        initial={{
          ...PERCENT_INITIAL,
          status: "approved",
          advancedCosts: 2500,
        }}
        canEdit
      />
    );
    expect(statusSelect().value).toBe("approved");
    expect(
      container.querySelector<HTMLInputElement>('input[name="advancedCosts"]')
        ?.value
    ).toBe("2500.00");
  });
});

describe("SettlementComposer — labels, errors, save (F889 / F891)", () => {
  test("fields are reachable by label", async () => {
    render(<SettlementComposer matterId="m1" initial={PERCENT_INITIAL} canEdit />);
    await expandForm();
    for (const label of [/^gross amount/i, /^firm fee %/i, /^advanced costs/i, /^status/i]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  test("an advanced-costs error is shown as text, not just a red border", async () => {
    vi.mocked(upsertSettlement).mockResolvedValueOnce({
      status: "error",
      errors: { advancedCosts: ["Enter a valid amount"] },
    });
    render(<SettlementComposer matterId="m1" initial={PERCENT_INITIAL} canEdit />);
    await expandForm();
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText("Enter a valid amount")).toBeInTheDocument();
  });

  test("a successful save of an existing settlement collapses the form, and so does a second one", async () => {
    vi.mocked(upsertSettlement).mockImplementation(async () => ({ status: "ok" as const }));
    render(<SettlementComposer matterId="m1" initial={PERCENT_INITIAL} canEdit />);
    for (let i = 0; i < 2; i++) {
      await expandForm();
      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(
        await screen.findByRole("button", {
          name: /edit gross \/ fee \/ costs \/ status/i,
        })
      ).toBeInTheDocument();
    }
  });

  test("a new settlement stays expanded after creating", async () => {
    vi.mocked(upsertSettlement).mockImplementation(async () => ({ status: "ok" as const }));
    render(<SettlementComposer matterId="m1" initial={null} canEdit />);
    await userEvent.type(screen.getByLabelText(/^gross amount/i), "1000");
    await userEvent.click(screen.getByRole("button", { name: /open settlement/i }));
    await waitFor(() => expect(upsertSettlement).toHaveBeenCalled());
    expect(screen.getByLabelText(/^gross amount/i)).toBeInTheDocument();
  });
});
