/**
 * Component tests for the team / role / firm settings forms.
 *
 * Pins the behaviours that used to be broken:
 *   - a rejected save keeps what the admin typed and ticked (React 19
 *     resets `<form action>` fields after every action; these forms
 *     dispatch manually);
 *   - `_form` errors and per-field errors (phone, bar number, ...)
 *     are actually rendered;
 *   - labels are associated with their controls;
 *   - the New-role composer collapses after EVERY successful create;
 *   - a delegated (non-Admin) directory manager sees privileged roles
 *     locked and no Edit / Reset / Unlock on Admin accounts;
 *   - RoleRow formats `createdAt` in the viewer's zone.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("@/app/actions/team", () => ({
  inviteFirmMember: vi.fn(),
  updateFirmMember: vi.fn(),
  resetFirmMemberPassword: vi.fn(),
  unlockFirmMemberSignIn: vi.fn(),
}));
vi.mock("@/app/actions/roles", () => ({
  createRoleAction: vi.fn(),
  updateRoleAction: vi.fn(),
  deleteRoleAction: vi.fn(),
}));
vi.mock("@/app/actions/firm", () => ({
  updateFirmAction: vi.fn(),
}));

import {
  inviteFirmMember,
  resetFirmMemberPassword,
  unlockFirmMemberSignIn,
  updateFirmMember,
} from "@/app/actions/team";
import { notifySuccess } from "@/lib/feedback";
import { createRoleAction, updateRoleAction } from "@/app/actions/roles";
import { updateFirmAction } from "@/app/actions/firm";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import type { FirmUserRow, FirmRoleRow, RoleChip } from "@/lib/queries/team";
import type { FirmProfile } from "@/lib/firm";
import { InviteMemberComposer } from "./invite-member-composer";
import { MemberEditForm } from "./member-edit-form";
import { MemberRow } from "./member-row";
import { CreateRoleForm } from "./create-role-form";
import { RoleRow } from "./role-row";
import { FirmEditForm } from "./firm-edit-form";

const mockedInvite = vi.mocked(inviteFirmMember);
const mockedUpdateMember = vi.mocked(updateFirmMember);
const mockedReset = vi.mocked(resetFirmMemberPassword);
const mockedUnlock = vi.mocked(unlockFirmMemberSignIn);
const mockedCreateRole = vi.mocked(createRoleAction);
const mockedUpdateRole = vi.mocked(updateRoleAction);
const mockedFirm = vi.mocked(updateFirmAction);

const ROLES: RoleChip[] = [
  { id: "r_admin", name: "Admin", isSystem: true },
  { id: "r_default", name: "default", isSystem: true },
  { id: "r_billing", name: "Billing", isSystem: false },
  { id: "r_access", name: "Access manager", isSystem: false },
];
const PRIVILEGED = ["r_admin", "r_access"];

const MEMBER: FirmUserRow = {
  id: "u1",
  name: "Pat Paralegal",
  email: "pat@example.com",
  initials: "PP",
  jobTitle: "Paralegal",
  phone: null,
  barNumber: null,
  isActive: true,
  roles: [ROLES[1]],
  isAdmin: false,
  isSelf: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const ADMIN_MEMBER: FirmUserRow = {
  ...MEMBER,
  id: "u2",
  name: "Alex Admin",
  roles: [ROLES[0], ROLES[1]],
  isAdmin: true,
};

beforeEach(() => {
  for (const m of [
    mockedInvite,
    mockedUpdateMember,
    mockedReset,
    mockedUnlock,
    mockedCreateRole,
    mockedUpdateRole,
    mockedFirm,
  ]) {
    m.mockReset();
  }
});

describe("InviteMemberComposer", () => {
  test("a rejected invite keeps the typed fields AND the ticked roles, and shows the field error", async () => {
    mockedInvite.mockResolvedValue({
      status: "error",
      errors: { email: ["A user with that email already exists."] },
      values: {},
    });
    const user = userEvent.setup();
    render(<InviteMemberComposer rolePickerOptions={ROLES} />);

    await user.click(screen.getByRole("button", { name: /invite member/i }));
    await user.type(screen.getByLabelText(/^name/i), "New Person");
    await user.type(screen.getByLabelText(/^email/i), "dup@example.com");
    await user.type(screen.getByLabelText(/^initials/i), "NP");
    await user.type(screen.getByLabelText(/^job title/i), "Paralegal");
    await user.click(screen.getByRole("checkbox", { name: /billing/i }));
    await user.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() =>
      expect(screen.getByText(/already exists/i)).toBeTruthy()
    );
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe(
      "New Person"
    );
    expect((screen.getByLabelText(/^email/i) as HTMLInputElement).value).toBe(
      "dup@example.com"
    );
    expect(
      (screen.getByRole("checkbox", { name: /billing/i }) as HTMLInputElement)
        .checked
    ).toBe(true);
    // The action got the ticked role.
    const fd = mockedInvite.mock.calls[0][1] as FormData;
    expect(fd.getAll("roleId")).toEqual(["r_billing"]);
  });

  test("renders a form-level error that has no field", async () => {
    mockedInvite.mockResolvedValue({
      status: "error",
      errors: { _form: ["Firm is missing the system 'default' role — re-seed."] },
      values: {},
    });
    const user = userEvent.setup();
    render(<InviteMemberComposer rolePickerOptions={ROLES} />);
    await user.click(screen.getByRole("button", { name: /invite member/i }));
    await user.type(screen.getByLabelText(/^name/i), "A");
    await user.type(screen.getByLabelText(/^email/i), "a@example.com");
    await user.type(screen.getByLabelText(/^initials/i), "A");
    await user.type(screen.getByLabelText(/^job title/i), "Paralegal");
    await user.click(screen.getByRole("button", { name: /send invite/i }));
    await waitFor(() =>
      expect(screen.getByText(/missing the system 'default' role/i)).toBeTruthy()
    );
  });

  test("a delegated manager sees the Admin and access-manager boxes locked", async () => {
    const user = userEvent.setup();
    render(
      <InviteMemberComposer
        rolePickerOptions={ROLES}
        viewerIsAdmin={false}
        privilegedRoleIds={PRIVILEGED}
      />
    );
    await user.click(screen.getByRole("button", { name: /invite member/i }));
    expect(
      (screen.getByRole("checkbox", { name: /^admin$/i }) as HTMLInputElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: /access manager/i }) as HTMLInputElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: /billing/i }) as HTMLInputElement)
        .disabled
    ).toBe(false);
  });

  test("shows the temp password after each successful invite, not just the first", async () => {
    mockedInvite
      .mockResolvedValueOnce({ status: "ok", invitePassword: "first-pw-1111" })
      .mockResolvedValueOnce({ status: "ok", invitePassword: "second-pw-2222" });
    const user = userEvent.setup();
    render(<InviteMemberComposer rolePickerOptions={ROLES} />);

    for (const [pw, email] of [
      ["first-pw-1111", "a@example.com"],
      ["second-pw-2222", "b@example.com"],
    ]) {
      await user.click(screen.getByRole("button", { name: /invite member/i }));
      await user.type(screen.getByLabelText(/^name/i), "X");
      await user.type(screen.getByLabelText(/^email/i), email);
      await user.type(screen.getByLabelText(/^initials/i), "X");
      await user.type(screen.getByLabelText(/^job title/i), "Paralegal");
      await user.click(screen.getByRole("button", { name: /send invite/i }));
      await waitFor(() => expect(screen.getByText(pw)).toBeTruthy());
      await user.click(screen.getByRole("button", { name: /dismiss/i }));
    }
  });
});

describe("MemberEditForm", () => {
  test("shows phone / bar number field errors and keeps the edits", async () => {
    mockedUpdateMember.mockResolvedValue({
      status: "error",
      errors: {
        phone: ["String must contain at most 40 character(s)"],
        barNumber: ["Too long"],
      },
      values: {},
    });
    const user = userEvent.setup();
    render(
      <MemberEditForm
        member={MEMBER}
        rolePickerOptions={ROLES}
        onDone={() => {}}
      />
    );
    await user.type(screen.getByLabelText(/^phone/i), "555-0100 ext 12");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText(/at most 40 character/i)).toBeTruthy()
    );
    expect(screen.getByText("Too long")).toBeTruthy();
    expect((screen.getByLabelText(/^phone/i) as HTMLInputElement).value).toBe(
      "555-0100 ext 12"
    );
  });

  test("renders the concurrent-edit (_form) error instead of failing silently", async () => {
    mockedUpdateMember.mockResolvedValue({
      status: "error",
      errors: {
        _form: ["Another team change happened at the same time — try again."],
      },
      values: {},
    });
    const user = userEvent.setup();
    render(
      <MemberEditForm
        member={MEMBER}
        rolePickerOptions={ROLES}
        onDone={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(screen.getByText(/try again/i)).toBeTruthy()
    );
  });

  test("for a delegated manager, a held privileged role is locked but still posted", async () => {
    mockedUpdateMember.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    render(
      <MemberEditForm
        member={{ ...MEMBER, roles: [ROLES[1], ROLES[3]] }}
        rolePickerOptions={ROLES}
        viewerIsAdmin={false}
        privilegedRoleIds={PRIVILEGED}
        onDone={() => {}}
      />
    );
    const access = screen.getByRole("checkbox", {
      name: /access manager/i,
    }) as HTMLInputElement;
    expect(access.disabled).toBe(true);
    expect(access.checked).toBe(true);
    // The member holds a privileged role: the Active toggle is locked.
    expect(screen.queryByRole("checkbox", { name: /active/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(mockedUpdateMember).toHaveBeenCalled());
    const fd = mockedUpdateMember.mock.calls[0][2] as FormData;
    expect(fd.getAll("roleId")).toContain("r_access");
    expect(fd.get("isActive")).toBe("on");
  });
});

describe("MemberRow", () => {
  function renderRow(props: {
    member: FirmUserRow;
    viewerIsAdmin: boolean;
  }) {
    return render(
      <table>
        <tbody>
          <MemberRow
            member={props.member}
            canManageDirectory
            rolePickerOptions={ROLES}
            viewerIsAdmin={props.viewerIsAdmin}
            privilegedRoleIds={PRIVILEGED}
          />
        </tbody>
      </table>
    );
  }

  test("an Admin viewer can edit, reset and unlock sign-in; unlock calls the action", async () => {
    mockedUnlock.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    renderRow({ member: ADMIN_MEMBER, viewerIsAdmin: true });
    await user.click(screen.getByRole("button", { name: /member actions/i }));
    expect(await screen.findByText("Edit")).toBeTruthy();
    expect(screen.getByText("Reset password")).toBeTruthy();
    await user.click(screen.getByText("Unlock sign-in"));
    await waitFor(() => expect(mockedUnlock).toHaveBeenCalledWith("u2"));
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());
  });

  test("a delegated manager gets no actions at all on an Admin account", () => {
    renderRow({ member: ADMIN_MEMBER, viewerIsAdmin: false });
    expect(screen.queryByRole("button", { name: /member actions/i })).toBeNull();
  });

  test("a delegated manager can still manage an ordinary member", async () => {
    const user = userEvent.setup();
    renderRow({ member: MEMBER, viewerIsAdmin: false });
    await user.click(screen.getByRole("button", { name: /member actions/i }));
    expect(await screen.findByText("Edit")).toBeTruthy();
    expect(screen.getByText("Reset password")).toBeTruthy();
  });
});

describe("CreateRoleForm", () => {
  test("collapses after every successful create, not only the first", async () => {
    mockedCreateRole.mockImplementation(async () => ({ status: "ok" as const }));
    const user = userEvent.setup();
    render(<CreateRoleForm />);

    for (const name of ["Billing", "Litigation"]) {
      await user.click(screen.getByRole("button", { name: /new role/i }));
      await user.type(screen.getByLabelText(/^name/i), name);
      await user.click(screen.getByRole("button", { name: /create role/i }));
      // Back to the collapsed "New role" button each time.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /new role/i })).toBeTruthy()
      );
    }
    expect(mockedCreateRole).toHaveBeenCalledTimes(2);
  });

  test("a rejected create keeps the typed name and shows the error", async () => {
    mockedCreateRole.mockResolvedValue({
      status: "error",
      errors: { name: ["A role with that name already exists."] },
      values: {},
    });
    const user = userEvent.setup();
    render(<CreateRoleForm />);
    await user.click(screen.getByRole("button", { name: /new role/i }));
    await user.type(screen.getByLabelText(/^name/i), "Paralegal");
    await user.click(screen.getByRole("button", { name: /create role/i }));
    await waitFor(() =>
      expect(screen.getByText(/already exists/i)).toBeTruthy()
    );
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe(
      "Paralegal"
    );
  });

  test("renders a permission-denied (_form) error", async () => {
    mockedCreateRole.mockResolvedValue({
      status: "error",
      errors: { _form: ["You do not have permission to do that."] },
    });
    const user = userEvent.setup();
    render(<CreateRoleForm />);
    await user.click(screen.getByRole("button", { name: /new role/i }));
    await user.type(screen.getByLabelText(/^name/i), "X");
    await user.click(screen.getByRole("button", { name: /create role/i }));
    await waitFor(() =>
      expect(screen.getByText(/do not have permission/i)).toBeTruthy()
    );
  });
});

describe("RoleRow", () => {
  const ROLE: FirmRoleRow = {
    id: "role1",
    name: "Billing",
    description: null,
    isSystem: false,
    memberCount: 2,
    // 01:00Z on Apr 16 is still the evening of Apr 15 in Denver.
    createdAt: new Date("2026-04-16T01:00:00Z"),
  };

  function renderRole(tz: string) {
    return render(
      <UserTimeZoneProvider timeZone={tz}>
        <table>
          <tbody>
            <RoleRow role={ROLE} isAdmin />
          </tbody>
        </table>
      </UserTimeZoneProvider>
    );
  }

  test("formats createdAt in the viewer's profile zone (no server/client drift)", () => {
    const { unmount } = renderRole("America/Denver");
    expect(screen.getByText("Apr 15, 2026")).toBeTruthy();
    unmount();
    renderRole("UTC");
    expect(screen.getByText("Apr 16, 2026")).toBeTruthy();
  });

  test("the rename form keeps the typed name after a rejection and labels its fields", async () => {
    mockedUpdateRole.mockResolvedValue({
      status: "error",
      errors: { name: ["Reserved name"] },
      values: {},
    });
    const user = userEvent.setup();
    renderRole("UTC");
    await user.click(screen.getByRole("button", { name: /role actions/i }));
    await user.click(await screen.findByText("Edit"));

    const name = screen.getByLabelText(/^name/i) as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "Admin2");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText("Reserved name")).toBeTruthy());
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe(
      "Admin2"
    );
    expect(screen.getByLabelText(/^description/i)).toBeTruthy();
  });
});

describe("FirmEditForm — rejected save", () => {
  const FIRM: FirmProfile = {
    id: "f1",
    name: "Kosloski Law",
    shortName: null,
    ein: null,
    website: null,
    phone: null,
    email: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zip: null,
    country: "US",
    establishedAt: null,
    logoUrl: null,
  };
  const GOALS = { dailyHoursGoal: 6, monthlyBillableGoal: 200 };

  // jsdom's floating-point step check rejects 200 against step=0.1
  // (browsers use decimal math), so submit the form directly.
  function submitFirmForm() {
    const form = screen
      .getByRole("button", { name: /save changes/i })
      .closest("form");
    if (!form) throw new Error("form not found");
    fireEvent.submit(form);
  }

  test("keeps every edit and shows messages for fields that previously showed none", async () => {
    mockedFirm.mockResolvedValue({
      status: "error",
      errors: {
        phone: ["String must contain at most 40 character(s)"],
        zip: ["Too long"],
      },
      values: {},
    });
    const user = userEvent.setup();
    render(<FirmEditForm firm={FIRM} goals={GOALS} />);

    await user.clear(screen.getByLabelText(/^firm name/i));
    await user.type(screen.getByLabelText(/^firm name/i), "Renamed LLP");
    await user.type(screen.getByLabelText(/^phone/i), "555-0100 ext 12");
    submitFirmForm();

    await waitFor(() =>
      expect(screen.getByText(/at most 40 character/i)).toBeTruthy()
    );
    expect(screen.getByText("Too long")).toBeTruthy();
    expect(
      (screen.getByLabelText(/^firm name/i) as HTMLInputElement).value
    ).toBe("Renamed LLP");
    expect((screen.getByLabelText(/^phone/i) as HTMLInputElement).value).toBe(
      "555-0100 ext 12"
    );
  });

  test("renders a permission-denied (_form) error", async () => {
    mockedFirm.mockResolvedValue({
      status: "error",
      errors: { _form: ["You do not have permission to do that."] },
    });
    render(<FirmEditForm firm={FIRM} goals={GOALS} />);
    submitFirmForm();
    await waitFor(() =>
      expect(screen.getByText(/do not have permission/i)).toBeTruthy()
    );
  });
});
