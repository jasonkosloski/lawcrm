/**
 * Tests for LeadAccessCard (restricted intake, ADR-049): restrict /
 * reopen go through a confirm, the last member's Remove is disabled,
 * add posts userId + role, server errors show inline, and viewers
 * without intake.restrict get a read-only list.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
}));
vi.mock("@/app/actions/lead-access", () => ({
  setLeadRestricted: vi.fn(async () => ({ ok: true })),
  addLeadTeamMember: vi.fn(async () => ({ ok: true })),
  removeLeadTeamMember: vi.fn(async () => ({ ok: true })),
}));

import {
  addLeadTeamMember,
  removeLeadTeamMember,
  setLeadRestricted,
} from "@/app/actions/lead-access";
import { confirmAction } from "@/lib/feedback";
import { LeadAccessCard, type LeadTeamRow } from "./lead-access-card";

const alice: LeadTeamRow = {
  userId: "u1",
  name: "Alice Attorney",
  initials: "AA",
  jobTitle: null,
  role: "lead",
};
const bob: LeadTeamRow = { ...alice, userId: "u2", name: "Bob Paralegal", role: "paralegal" };
const options = [
  { id: "u1", name: "Alice Attorney", jobTitle: null },
  { id: "u3", name: "Cara Clerk", jobTitle: "Clerk" },
];

beforeEach(() => vi.clearAllMocks());

describe("LeadAccessCard", () => {
  test("an open lead offers Restrict behind a confirm", async () => {
    render(
      <LeadAccessCard leadId="l1" restricted={false} members={[]} userOptions={options} canManage />
    );
    expect(screen.getByText(/everyone at the firm can see/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /restrict/i }));
    expect(confirmAction).toHaveBeenCalled();
    await waitFor(() => expect(setLeadRestricted).toHaveBeenCalledWith("l1", true));
  });

  test("a cancelled confirm changes nothing", async () => {
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    render(
      <LeadAccessCard leadId="l1" restricted members={[alice]} userOptions={options} canManage />
    );
    await userEvent.click(screen.getByRole("button", { name: /open to firm/i }));
    expect(setLeadRestricted).not.toHaveBeenCalled();
  });

  test("the last member of a restricted lead can't be removed", () => {
    render(
      <LeadAccessCard leadId="l1" restricted members={[alice]} userOptions={options} canManage />
    );
    expect(
      (screen.getByRole("button", { name: "Remove Alice Attorney" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  test("removing one of two members calls the action; errors show inline", async () => {
    vi.mocked(removeLeadTeamMember).mockResolvedValueOnce({ ok: false, error: "Nope." });
    render(
      <LeadAccessCard leadId="l1" restricted members={[alice, bob]} userOptions={options} canManage />
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Bob Paralegal" }));
    await waitFor(() => expect(removeLeadTeamMember).toHaveBeenCalledWith("l1", "u2"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Nope.");
  });

  test("add posts the picked user and role; existing members aren't offered", async () => {
    render(
      <LeadAccessCard leadId="l1" restricted members={[alice]} userOptions={options} canManage />
    );
    const [userSelect, roleSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect([...userSelect.options].map((o) => o.value)).toEqual(["", "u3"]);
    await userEvent.selectOptions(userSelect, "u3");
    await userEvent.selectOptions(roleSelect, "investigator");
    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    await waitFor(() => expect(addLeadTeamMember).toHaveBeenCalled());
    const fd = vi.mocked(addLeadTeamMember).mock.calls[0]![1] as FormData;
    expect(fd.get("userId")).toBe("u3");
    expect(fd.get("role")).toBe("investigator");
  });

  test("without intake.restrict the team is read-only", () => {
    render(
      <LeadAccessCard
        leadId="l1"
        restricted
        members={[alice, bob]}
        userOptions={[]}
        canManage={false}
      />
    );
    expect(screen.getByText("Bob Paralegal")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
