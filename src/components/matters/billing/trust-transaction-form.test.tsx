/**
 * Tests for TrustTransactionForm.
 *
 * Regression pinned (F094 / F469): React 19 resets a `<form
 * action>` after the action settles, error or not. For this IOLTA
 * composer that meant an overdraw error snapped the Type select back
 * to "Deposit" and wiped amount / description, so the corrected
 * resubmit posted a DEPOSIT where the user meant a disbursement. The
 * form now dispatches via onSubmit + startTransition, so nothing the
 * user typed is lost after a server error.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/billing", () => ({
  addTrustTransaction: vi.fn(),
}));

import { addTrustTransaction } from "@/app/actions/billing";
import { TrustTransactionForm } from "./trust-transaction-form";
import { UserTimeZoneProvider } from "@/components/user-time-zone";

const mockedAction = vi.mocked(addTrustTransaction);

beforeEach(() => {
  mockedAction.mockReset();
});

const typeSelect = () => document.querySelector('select[name="type"]') as HTMLSelectElement;
const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement;

const postedFields = (call: number) => {
  const fd = mockedAction.mock.calls[call]![2] as FormData;
  return {
    type: fd.get("type"),
    amount: fd.get("amount"),
    description: fd.get("description"),
    reference: fd.get("reference"),
  };
};

describe("TrustTransactionForm — keeps input after a server error", () => {
  test("a rejected disbursement keeps type + typed fields, and the resubmit is still a disbursement", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockedAction.mockImplementationOnce(async () => ({
      status: "error" as const,
      error: "Trust would overdraw — current balance is $3,000.00.",
    }));
    mockedAction.mockImplementation(async () => ({ status: "ok" as const }));

    render(<TrustTransactionForm matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /add transaction/i }));

    await user.selectOptions(typeSelect(), "disbursement");
    await user.type(field("amount"), "5000");
    await user.type(field("description"), "Settlement disbursement");
    await user.type(field("reference"), "wire-77");
    await user.click(screen.getByRole("button", { name: /record transaction/i }));

    expect(await screen.findByText(/Trust would overdraw/i)).toBeInTheDocument();
    expect(postedFields(0)).toMatchObject({
      type: "disbursement",
      amount: "5000",
    });

    // Nothing the user entered was reset by the failed submit.
    expect(typeSelect().value).toBe("disbursement");
    expect(field("amount").value).toBe("5000");
    expect(field("description").value).toBe("Settlement disbursement");
    expect(field("reference").value).toBe("wire-77");

    // Correct the amount and resubmit: still a disbursement.
    await user.clear(field("amount"));
    await user.type(field("amount"), "500");
    await user.click(screen.getByRole("button", { name: /record transaction/i }));

    await waitFor(() => expect(mockedAction).toHaveBeenCalledTimes(2));
    expect(postedFields(1)).toMatchObject({
      type: "disbursement",
      amount: "500",
      description: "Settlement disbursement",
      reference: "wire-77",
    });
  });

  test("success collapses the form and the next open starts blank on Deposit", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockedAction.mockImplementation(async () => ({ status: "ok" as const }));

    render(<TrustTransactionForm matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /add transaction/i }));
    await user.selectOptions(typeSelect(), "refund");
    await user.type(field("amount"), "10");
    await user.type(field("description"), "Refund to client");
    await user.click(screen.getByRole("button", { name: /record transaction/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /add transaction/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /add transaction/i }));
    expect(typeSelect().value).toBe("deposit");
    expect(field("amount").value).toBe("");
  });

  test("collapses after every successful submit, not just the first", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
    render(<TrustTransactionForm matterId="m1" />);

    for (let round = 0; round < 2; round++) {
      await user.click(screen.getByRole("button", { name: /add transaction/i }));
      await user.type(field("amount"), "10");
      await user.type(field("description"), "Deposit");
      await user.click(screen.getByRole("button", { name: /record transaction/i }));
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: /record transaction/i }),
        ).not.toBeInTheDocument(),
      );
    }
    expect(mockedAction).toHaveBeenCalledTimes(2);
  });
});

describe("TrustTransactionForm — labels and date default", () => {
  test("every field is associated with its label", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<TrustTransactionForm matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /add transaction/i }));
    expect(screen.getByLabelText(/^type/i)).toHaveAttribute("name", "type");
    expect(screen.getByLabelText(/^amount/i)).toHaveAttribute("name", "amount");
    expect(screen.getByLabelText(/^description/i)).toHaveAttribute("name", "description");
    expect(screen.getByLabelText(/^reference/i)).toHaveAttribute("name", "reference");
    expect(screen.getByLabelText(/^date/i)).toHaveAttribute("name", "date");
  });

  test("the date defaults to the viewer's today in their zone (an evening in Denver is still that day)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 02:00Z on Apr 28 = 8 PM MDT on Apr 27.
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
    try {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      render(
        <UserTimeZoneProvider timeZone="America/Denver">
          <TrustTransactionForm matterId="m1" />
        </UserTimeZoneProvider>,
      );
      await user.click(screen.getByRole("button", { name: /add transaction/i }));
      expect(screen.getByLabelText(/^date/i)).toHaveValue("2026-04-27");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TrustTransactionForm — portal visibility warning", () => {
  const WARNING = "Descriptions are visible to the client in the portal.";
  const open = async (portalBillingEnabled?: boolean) => {
    render(
      <UserTimeZoneProvider timeZone="America/Denver">
        <TrustTransactionForm matterId="m1" portalBillingEnabled={portalBillingEnabled} />
      </UserTimeZoneProvider>,
    );
    await userEvent.click(screen.getByText("Add transaction"));
  };

  test("shown when billing is visible in the portal", async () => {
    await open(true);
    expect(screen.getByText(WARNING)).toBeTruthy();
  });

  test("hidden otherwise", async () => {
    await open(false);
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});
