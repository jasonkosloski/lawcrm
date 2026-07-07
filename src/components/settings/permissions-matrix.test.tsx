/**
 * Tests for PermissionsMatrix.
 *
 * Stubs `setRolePermissionAction` at the module level so the
 * component's optimistic-toggle logic can be exercised without a
 * real DB. Each test sets the stub's return value to control the
 * happy / failure paths.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the server action BEFORE importing the component so the
// import inside the component resolves to the mock.
vi.mock("@/app/actions/roles", () => ({
  setRolePermissionAction: vi.fn(),
}));

import { setRolePermissionAction } from "@/app/actions/roles";
import { PermissionsMatrix } from "./permissions-matrix";

const mockedAction = vi.mocked(setRolePermissionAction);

const ROLES = [
  { id: "role_admin", name: "Admin", isSystem: true },
  { id: "role_default", name: "default", isSystem: true },
  { id: "role_billing", name: "Billing manager", isSystem: false },
];

const SAMPLE_KEY = "matters.manage_team";
const ANOTHER_KEY = "billing.send_invoice";

beforeEach(() => {
  mockedAction.mockReset();
  // Default: every action call succeeds.
  mockedAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PermissionsMatrix — read-only (canEdit=false)", () => {
  test("renders every role as a column header", () => {
    render(
      <PermissionsMatrix roles={ROLES} grants={{}} canEdit={false} />
    );
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("Billing manager")).toBeInTheDocument();
  });

  test("every checkbox is disabled when canEdit is false", () => {
    render(
      <PermissionsMatrix
        roles={ROLES}
        grants={{ role_billing: [SAMPLE_KEY] }}
        canEdit={false}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      expect(cb).toBeDisabled();
    }
  });

  test("Admin column is fully checked regardless of grants", () => {
    render(
      <PermissionsMatrix roles={ROLES} grants={{}} canEdit />
    );
    // Every Admin-row checkbox should be checked. We find them by
    // aria-label which the matrix sets to "<permission> for <role>".
    const adminBoxes = screen
      .getAllByRole("checkbox")
      .filter((cb) =>
        cb.getAttribute("aria-label")?.endsWith("for Admin")
      );
    expect(adminBoxes.length).toBeGreaterThan(0);
    for (const cb of adminBoxes) {
      expect(cb).toBeChecked();
    }
  });
});

describe("PermissionsMatrix — Admin column lock", () => {
  test("Admin checkboxes are always disabled (even when canEdit)", () => {
    render(
      <PermissionsMatrix roles={ROLES} grants={{}} canEdit />
    );
    const adminBox = screen.getByRole("checkbox", {
      name: `Manage team members for Admin`,
    });
    expect(adminBox).toBeDisabled();
    expect(adminBox).toBeChecked();
  });

  test("clicking the Admin row never calls the action", async () => {
    const user = userEvent.setup();
    render(<PermissionsMatrix roles={ROLES} grants={{}} canEdit />);

    const adminBox = screen.getByRole("checkbox", {
      name: `Manage team members for Admin`,
    });
    await user.click(adminBox);
    // Click should be a no-op — the toggle handler bails on
    // isAdminRole and the input itself is disabled.
    expect(mockedAction).not.toHaveBeenCalled();
  });
});

describe("PermissionsMatrix — toggling cells", () => {
  test("clicking an unchecked Billing-manager cell calls the action with granted=true", async () => {
    const user = userEvent.setup();
    render(<PermissionsMatrix roles={ROLES} grants={{}} canEdit />);

    const cell = screen.getByRole("checkbox", {
      name: `Manage team members for Billing manager`,
    });
    expect(cell).not.toBeChecked();

    await user.click(cell);

    expect(mockedAction).toHaveBeenCalledTimes(1);
    expect(mockedAction).toHaveBeenCalledWith(
      "role_billing",
      SAMPLE_KEY,
      true
    );
  });

  test("clicking an already-granted cell calls the action with granted=false (revoke)", async () => {
    const user = userEvent.setup();
    render(
      <PermissionsMatrix
        roles={ROLES}
        grants={{ role_billing: [SAMPLE_KEY] }}
        canEdit
      />
    );

    const cell = screen.getByRole("checkbox", {
      name: `Manage team members for Billing manager`,
    });
    expect(cell).toBeChecked();

    await user.click(cell);

    expect(mockedAction).toHaveBeenCalledWith(
      "role_billing",
      SAMPLE_KEY,
      false
    );
  });

  test("toggle is optimistic — checkbox flips before the action resolves", async () => {
    // Make the action hang so we can assert the optimistic state
    // mid-flight.
    let resolveAction: (value: { ok: boolean }) => void = () => {};
    mockedAction.mockImplementation(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveAction = resolve;
        })
    );
    const user = userEvent.setup();
    render(<PermissionsMatrix roles={ROLES} grants={{}} canEdit />);

    const cell = screen.getByRole("checkbox", {
      name: `Manage team members for Billing manager`,
    });
    await user.click(cell);
    // Optimistic flip — the cell should already read checked even
    // though the action hasn't resolved.
    expect(cell).toBeChecked();
    resolveAction({ ok: true });
  });

  test("clicking the cell padding mid-flight doesn't fire a second toggle", async () => {
    // Hang the action so the first toggle stays in flight.
    let resolveAction: (value: { ok: boolean }) => void = () => {};
    mockedAction.mockImplementation(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveAction = resolve;
        })
    );
    const user = userEvent.setup();
    render(<PermissionsMatrix roles={ROLES} grants={{}} canEdit />);

    const cell = screen.getByRole("checkbox", {
      name: `Manage team members for Billing manager`,
    });
    await user.click(cell);
    expect(mockedAction).toHaveBeenCalledTimes(1);

    // The disabled attribute blocks the checkbox itself, but the
    // wrapping <td> has its own onClick — clicking the padding
    // around the box must be a no-op while the save is pending.
    const td = cell.closest("td");
    expect(td).not.toBeNull();
    await user.click(td!);
    expect(mockedAction).toHaveBeenCalledTimes(1);

    resolveAction({ ok: true });
  });

  test("granting one cell doesn't flip another", async () => {
    const user = userEvent.setup();
    render(<PermissionsMatrix roles={ROLES} grants={{}} canEdit />);

    const cellA = screen.getByRole("checkbox", {
      name: `Manage team members for Billing manager`,
    });
    const cellB = screen.getByRole("checkbox", {
      name: `Send invoices for Billing manager`,
    });

    await user.click(cellA);
    expect(cellA).toBeChecked();
    expect(cellB).not.toBeChecked();
  });
});

describe("PermissionsMatrix — error revert", () => {
  test("server error reverts the optimistic flip + surfaces the warning", async () => {
    mockedAction.mockResolvedValueOnce({
      ok: false,
      error: "Admin grants every permission by definition.",
    });
    const user = userEvent.setup();
    render(<PermissionsMatrix roles={ROLES} grants={{}} canEdit />);

    const cell = screen.getByRole("checkbox", {
      name: `${ANOTHER_KEY === "billing.send_invoice" ? "Send invoices" : ANOTHER_KEY} for Billing manager`,
    });
    await user.click(cell);

    // The warning text from the server response.
    expect(
      await screen.findByText(/Admin grants every permission/)
    ).toBeInTheDocument();
    // Cell reverted back to unchecked.
    expect(cell).not.toBeChecked();
  });
});
