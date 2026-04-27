/**
 * Tests for SettlementApprovals.
 *
 * What's worth pinning down:
 *   - Approve / Reject / Reset buttons fire the action with the
 *     right approval id + status + optional note.
 *   - canApprove=false hides every button (read-only mode).
 *   - settlementLocked (disbursed/closed) hides every button even
 *     when the user has the permission.
 *   - Rolled-up counter at the top reflects approved + rejected
 *     counts.
 *   - Approver attribution + notes render correctly.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/settlements", () => ({
  setApprovalStepStatus: vi.fn(),
}));

import { setApprovalStepStatus } from "@/app/actions/settlements";
import { SettlementApprovals } from "./settlement-approvals";

const mockedAction = vi.mocked(setApprovalStepStatus);

const SAMPLE_APPROVALS = [
  {
    id: "a1",
    step: 1,
    label: "Client release signed",
    status: "pending",
    approverName: null,
    approvedAt: null,
    notes: null,
  },
  {
    id: "a2",
    step: 2,
    label: "Lien negotiations finalized",
    status: "approved",
    approverName: "Jason Kosloski",
    approvedAt: new Date("2026-04-25T12:00:00Z"),
    notes: null,
  },
  {
    id: "a3",
    step: 3,
    label: "Partner sign-off",
    status: "rejected",
    approverName: null,
    approvedAt: null,
    notes: "Need updated medical bills.",
  },
  {
    id: "a4",
    step: 4,
    label: "Trust ledger reconciliation",
    status: "pending",
    approverName: null,
    approvedAt: null,
    notes: null,
  },
];

beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SettlementApprovals — read-only modes", () => {
  test("renders nothing when approvals list is empty", () => {
    const { container } = render(
      <SettlementApprovals
        approvals={[]}
        canApprove
        settlementLocked={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test("canApprove=false hides every action button (just status display)", () => {
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove={false}
        settlementLocked={false}
      />
    );
    expect(
      screen.queryByRole("button", { name: /^approve$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^reject$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^reset$/i })
    ).not.toBeInTheDocument();
  });

  test("settlementLocked hides every action button even when canApprove", () => {
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove
        settlementLocked
      />
    );
    expect(
      screen.queryByRole("button", { name: /^approve$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^reject$/i })
    ).not.toBeInTheDocument();
  });

  test("approver attribution shows on approved steps", () => {
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove={false}
        settlementLocked={false}
      />
    );
    expect(screen.getByText(/Approved by Jason Kosloski/)).toBeInTheDocument();
  });

  test("rejected steps render their notes", () => {
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove={false}
        settlementLocked={false}
      />
    );
    expect(
      screen.getByText("Need updated medical bills.")
    ).toBeInTheDocument();
  });
});

describe("SettlementApprovals — counter header", () => {
  test("counts approvals + rejections accurately", () => {
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove
        settlementLocked={false}
      />
    );
    // 1 approved out of 4, 1 rejected. Both surface in the header.
    expect(screen.getByText(/1\/4 approved/)).toBeInTheDocument();
    expect(screen.getByText(/1 rejected/)).toBeInTheDocument();
  });

  test("rejected count omitted when none are rejected", () => {
    render(
      <SettlementApprovals
        approvals={[
          { ...SAMPLE_APPROVALS[0], status: "approved" },
          { ...SAMPLE_APPROVALS[1] },
        ]}
        canApprove
        settlementLocked={false}
      />
    );
    expect(screen.getByText(/2\/2 approved/)).toBeInTheDocument();
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
  });
});

describe("SettlementApprovals — actions fire correctly", () => {
  test("Approve fires the action with status='approved' and the approval id", async () => {
    const user = userEvent.setup();
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove
        settlementLocked={false}
      />
    );
    // Pending steps have Approve buttons; click the first one.
    const approveButtons = screen.getAllByRole("button", {
      name: /^approve$/i,
    });
    expect(approveButtons.length).toBeGreaterThan(0);
    await user.click(approveButtons[0]);

    expect(mockedAction).toHaveBeenCalledTimes(1);
    expect(mockedAction).toHaveBeenCalledWith("a1", "approved", undefined);
  });

  test("Reject fires the action with status='rejected'", async () => {
    const user = userEvent.setup();
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove
        settlementLocked={false}
      />
    );
    const rejectButtons = screen.getAllByRole("button", {
      name: /^reject$/i,
    });
    await user.click(rejectButtons[0]);
    expect(mockedAction).toHaveBeenCalledWith("a1", "rejected", undefined);
  });

  test("Reset fires the action with status='pending' for approved/rejected steps", async () => {
    const user = userEvent.setup();
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove
        settlementLocked={false}
      />
    );
    const resetButtons = screen.getAllByRole("button", {
      name: /^reset$/i,
    });
    // a2 (approved) + a3 (rejected) both get a Reset; a1 + a4
    // (pending) don't.
    expect(resetButtons.length).toBe(2);
    await user.click(resetButtons[0]);
    expect(mockedAction).toHaveBeenCalledWith("a2", "pending", undefined);
  });

  test("optional note typed inline gets passed to the action", async () => {
    const user = userEvent.setup();
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove
        settlementLocked={false}
      />
    );
    // Find the inline note input attached to the first pending
    // step (a1). It has placeholder "Optional note".
    const noteInputs = screen.getAllByPlaceholderText("Optional note");
    expect(noteInputs.length).toBeGreaterThan(0);
    await user.type(noteInputs[0], "Verified by phone");
    const approveButtons = screen.getAllByRole("button", {
      name: /^approve$/i,
    });
    await user.click(approveButtons[0]);
    expect(mockedAction).toHaveBeenCalledWith(
      "a1",
      "approved",
      "Verified by phone"
    );
  });
});

describe("SettlementApprovals — error surface", () => {
  test("server error renders inline above the list", async () => {
    mockedAction.mockResolvedValueOnce({
      ok: false,
      error: "Settlement is already disbursed.",
    });
    const user = userEvent.setup();
    render(
      <SettlementApprovals
        approvals={SAMPLE_APPROVALS}
        canApprove
        settlementLocked={false}
      />
    );
    await user.click(
      screen.getAllByRole("button", { name: /^approve$/i })[0]
    );
    expect(
      await screen.findByText(/Settlement is already disbursed/)
    ).toBeInTheDocument();
  });
});

// Suppress unused-import warning when only some helpers are used.
void within;
