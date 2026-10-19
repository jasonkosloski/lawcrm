/**
 * Tests for MatterTeamManagement: add, remove, error banner, thrown
 * action errors (must not escape to the route error boundary), the lead
 * row's Remove guard, per-operation pending label, and select labels.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("@/app/actions/matters", () => ({
  addMatterTeamMember: vi.fn(),
  removeMatterTeamMember: vi.fn(),
}));

import {
  addMatterTeamMember,
  removeMatterTeamMember,
} from "@/app/actions/matters";
import { confirmAction } from "@/lib/feedback";
import {
  MatterTeamManagement,
  type TeamMemberRow,
  type TeamUserOption,
} from "./matter-team-management";

const mockedAdd = vi.mocked(addMatterTeamMember);
const mockedRemove = vi.mocked(removeMatterTeamMember);

const members: TeamMemberRow[] = [
  {
    membershipId: "mem-lead",
    userId: "u-lead",
    name: "Dana Lead",
    jobTitle: "Attorney",
    initials: "DL",
    role: "lead",
    removedAt: null,
  },
  {
    membershipId: "mem-para",
    userId: "u-para",
    name: "Pat Paralegal",
    jobTitle: "Paralegal",
    initials: "PP",
    role: "paralegal",
    removedAt: null,
  },
  {
    membershipId: "mem-old",
    userId: "u-old",
    name: "Old Member",
    jobTitle: null,
    initials: null,
    role: "co_counsel",
    removedAt: new Date("2026-01-01T00:00:00Z"),
  },
];

const userOptions: TeamUserOption[] = [
  { id: "u-lead", name: "Dana Lead", jobTitle: "Attorney" },
  { id: "u-new", name: "Nia New", jobTitle: "Associate" },
];

beforeEach(() => {
  mockedAdd.mockReset();
  mockedRemove.mockReset();
  vi.mocked(confirmAction).mockResolvedValue(true);
});

const renderCard = () =>
  render(
    <MatterTeamManagement
      matterId="m1"
      members={members}
      userOptions={userOptions}
    />
  );

describe("MatterTeamManagement", () => {
  test("the selects have accessible names (label click target)", () => {
    renderCard();
    expect(screen.getByLabelText("Add member")).toBeTruthy();
    expect(screen.getByLabelText("Role")).toBeTruthy();
  });

  test("adds a member with the chosen role", async () => {
    mockedAdd.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderCard();
    await user.selectOptions(screen.getByLabelText("Add member"), "u-new");
    await user.selectOptions(screen.getByLabelText("Role"), "paralegal");
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(mockedAdd).toHaveBeenCalledTimes(1));
    const [matterId, fd] = mockedAdd.mock.calls[0]!;
    expect(matterId).toBe("m1");
    expect(fd.get("userId")).toBe("u-new");
    expect(fd.get("role")).toBe("paralegal");
  });

  test("shows the server's error message in the banner", async () => {
    mockedAdd.mockResolvedValue({ ok: false, error: "Already on the team." });
    const user = userEvent.setup();
    renderCard();
    await user.selectOptions(screen.getByLabelText("Add member"), "u-new");
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(await screen.findByText("Already on the team.")).toBeTruthy();
  });

  test("a thrown add error becomes a banner instead of escaping to the error boundary", async () => {
    mockedAdd.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderCard();
    await user.selectOptions(screen.getByLabelText("Add member"), "u-new");
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(
      await screen.findByText(/couldn.t update the team/i)
    ).toBeTruthy();
    // The button is usable again for a retry.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^add$/i })).toBeEnabled()
    );
  });

  test("removes a member after confirmation", async () => {
    mockedRemove.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Remove Pat Paralegal" }));
    await waitFor(() =>
      expect(mockedRemove).toHaveBeenCalledWith("m1", "mem-para")
    );
  });

  test("a thrown remove error becomes a banner", async () => {
    mockedRemove.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Remove Pat Paralegal" }));
    expect(
      await screen.findByText(/couldn.t update the team/i)
    ).toBeTruthy();
  });

  test("the lead's Remove button is disabled (the server always refuses it)", () => {
    renderCard();
    const lead = screen.getByRole("button", { name: "Remove Dana Lead" });
    expect(lead).toBeDisabled();
    expect(lead).toHaveAttribute("title", "Promote another member to lead first");
    expect(
      screen.getByRole("button", { name: "Remove Pat Paralegal" })
    ).toBeEnabled();
  });

  test("the Add button only reads 'Adding…' during an add, not a removal", async () => {
    let finish!: (v: { ok: true }) => void;
    mockedRemove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Remove Pat Paralegal" }));
    await waitFor(() => expect(mockedRemove).toHaveBeenCalled());
    expect(screen.queryByText("Adding…")).toBeNull();
    finish({ ok: true });
  });

  test("former members are listed read-only", () => {
    renderCard();
    expect(screen.getByText("Old Member")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Old Member" })).toBeNull();
  });
});
