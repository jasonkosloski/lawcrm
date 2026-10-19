/**
 * StageChanger — `matters.edit` gating, the transition flow (including
 * the unusual-move confirmation + force retry and the revert on
 * refusal), and the archived-current-stage fallback.
 */

import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("@/app/actions/matters", () => ({
  updateMatterStage: vi.fn(),
}));

import { updateMatterStage } from "@/app/actions/matters";
import { confirmAction, notifyError } from "@/lib/feedback";
import { StageChanger, stepperSteps, type StageOption } from "./stage-changer";

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
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s3" canEdit />
    );
    await pick("Intake");
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(2));
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Reopen a closed matter?" })
    );
    expect(mockedUpdate).toHaveBeenLastCalledWith("m1", "s1", { force: true });
  });

  test("declining the confirmation does not retry and reverts the stepper", async () => {
    mockedUpdate.mockResolvedValue({
      ok: false,
      requiresConfirmation: true,
      warning: "Reopen a closed matter?",
    });
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
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
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s1" canEdit />
    );
    await pick("Discovery");
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Nope."));
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
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s3" canEdit />
    );
    await pick("Intake");
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("Still refused.")
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

describe("stepper — several terminal stages collapse into one end dot", () => {
  const criminal: StageOption[] = [
    { id: "a", name: "Arraignment", order: 1, isTerminal: false },
    { id: "b", name: "Discovery", order: 2, isTerminal: false },
    { id: "d", name: "Dismissed", order: 3, isTerminal: true },
    { id: "c", name: "Convicted", order: 4, isTerminal: true },
    { id: "q", name: "Acquitted", order: 5, isTerminal: true },
  ];

  test("open matter: one 'Closed' end step listing the outcomes", () => {
    const { steps, currentIndex } = stepperSteps(criminal, "b");
    expect(steps.map((s) => s.label)).toEqual(["Arraignment", "Discovery", "Closed"]);
    expect(steps[2].title).toBe("Ends as: Dismissed / Convicted / Acquitted");
    expect(currentIndex).toBe(1);
  });

  test("closed matter: the end step shows the actual outcome and is current", () => {
    const { steps, currentIndex } = stepperSteps(criminal, "q");
    expect(steps.map((s) => s.label)).toEqual(["Arraignment", "Discovery", "Acquitted"]);
    expect(currentIndex).toBe(2);
  });

  test("a single terminal stage renders exactly as configured", () => {
    const { steps } = stepperSteps(stages, "s1");
    expect(steps.map((s) => s.label)).toEqual(["Intake", "Discovery", "Closed"]);
    expect(steps[2].key).toBe("s3");
  });

  test("renders three dots and counts remaining steps on the collapsed stepper", () => {
    render(<StageChanger matterId="m1" stages={criminal} currentStageId="a" canEdit={false} />);
    expect(document.querySelectorAll('[title]').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTitle("Ends as: Dismissed / Convicted / Acquitted")).toBeInTheDocument();
    expect(screen.queryByText("Convicted")).toBeNull();
    expect(screen.getByText(/2 stages\s+remaining/)).toBeInTheDocument();
  });

  test("the Change stage menu still offers every outcome", async () => {
    render(<StageChanger matterId="m1" stages={criminal} currentStageId="b" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /change stage/i }));
    for (const name of ["Dismissed", "Convicted", "Acquitted"]) {
      expect(await screen.findByText(name)).toBeInTheDocument();
    }
  });
});
