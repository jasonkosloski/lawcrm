/**
 * StageChanger — `matters.edit` gating, the transition flow (including
 * the unusual-move confirmation + force retry and the revert on
 * refusal), and the archived-current-stage fallback.
 */

import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/app/actions/matters", () => ({
  updateMatterStage: vi.fn(),
}));

import { updateMatterStage } from "@/app/actions/matters";
import { StageChanger, type StageOption } from "./stage-changer";

const mockedUpdate = vi.mocked(updateMatterStage);

const stages: StageOption[] = [
  { id: "s1", name: "Intake", order: 1, isTerminal: false },
  { id: "s2", name: "Discovery", order: 2, isTerminal: false },
  { id: "s3", name: "Closed", order: 3, isTerminal: true },
];

beforeEach(() => {
  mockedUpdate.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StageChanger — permission gating", () => {
  test("editors see the Change stage control", () => {
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s2" canEdit />
    );
    expect(screen.getByText("Change stage")).toBeInTheDocument();
  });

  test("non-editors see the stepper but no Change stage control", () => {
    render(
      <StageChanger
        matterId="m1"
        stages={stages}
        currentStageId="s2"
        canEdit={false}
      />
    );
    expect(screen.queryByText("Change stage")).not.toBeInTheDocument();
    expect(screen.getAllByText("Discovery").length).toBeGreaterThan(0);
  });
});

/** Open the picker and click the named stage's row. */
async function pick(name: string) {
  fireEvent.click(screen.getByText("Change stage"));
  const row = await screen.findByRole("button", { name: new RegExp(name) });
  fireEvent.click(row);
}

describe("StageChanger — transition flow", () => {
  test("a normal move calls the action once, without force", async () => {
    mockedUpdate.mockResolvedValue({ ok: true });
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s1" canEdit />
    );
    await pick("Discovery");
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate).toHaveBeenCalledWith("m1", "s2");
  });

  test("an unusual move asks for confirmation and retries with force:true when accepted", async () => {
    mockedUpdate
      .mockResolvedValueOnce({
        ok: false,
        requiresConfirmation: true,
        warning: "Reopen a closed matter?",
      })
      .mockResolvedValueOnce({ ok: true });
    const confirmSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmSpy);
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s3" canEdit />
    );
    await pick("Intake");
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(2));
    expect(confirmSpy).toHaveBeenCalledWith("Reopen a closed matter?");
    expect(mockedUpdate).toHaveBeenLastCalledWith("m1", "s1", { force: true });
  });

  test("declining the confirmation does not retry and reverts the stepper", async () => {
    mockedUpdate.mockResolvedValue({
      ok: false,
      requiresConfirmation: true,
      warning: "Reopen a closed matter?",
    });
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s3" canEdit />
    );
    await pick("Intake");
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    // Back on the original terminal stage.
    await waitFor(() =>
      expect(screen.getByText(/Matter is/)).toBeInTheDocument()
    );
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  test("a refusal alerts the error and reverts", async () => {
    mockedUpdate.mockResolvedValue({ ok: false, error: "Nope." });
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s1" canEdit />
    );
    await pick("Discovery");
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Nope."));
    await waitFor(() =>
      expect(screen.getByText(/Currently in/).textContent).toContain("Intake")
    );
  });

  test("a forced retry that still fails alerts and reverts", async () => {
    mockedUpdate
      .mockResolvedValueOnce({
        ok: false,
        requiresConfirmation: true,
        warning: "Are you sure?",
      })
      .mockResolvedValueOnce({ ok: false, error: "Still refused." });
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s3" canEdit />
    );
    await pick("Intake");
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("Still refused.")
    );
  });
});

describe("StageChanger — archived current stage (F786)", () => {
  const withArchived: StageOption[] = [
    { id: "s1", name: "Intake", order: 1, isTerminal: false },
    { id: "old", name: "Old review", order: 2, isTerminal: false, isActive: false },
    { id: "s3", name: "Closed", order: 3, isTerminal: true },
  ];

  test("names the archived stage the matter sits in instead of a blank", () => {
    render(
      <StageChanger
        matterId="m1"
        stages={withArchived}
        currentStageId="old"
        canEdit={false}
      />
    );
    const subtitle = screen.getByText(/Currently in/);
    expect(subtitle.textContent).toContain("Old review (archived)");
  });

  test("does not offer an archived stage as a move target", async () => {
    render(
      <StageChanger
        matterId="m1"
        stages={withArchived}
        currentStageId="s1"
        canEdit
      />
    );
    fireEvent.click(screen.getByText("Change stage"));
    await screen.findByText("Move matter to…");
    expect(screen.queryByRole("button", { name: /Old review/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Closed/ })).toBeInTheDocument();
  });

  test("falls back to a neutral label if the current stage is missing from the list", () => {
    render(
      <StageChanger
        matterId="m1"
        stages={stages}
        currentStageId="gone"
        canEdit={false}
      />
    );
    expect(screen.getByText(/Currently in/).textContent).toContain(
      "a stage that is no longer listed"
    );
  });
});
