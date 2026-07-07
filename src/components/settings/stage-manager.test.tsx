/**
 * Tests for StageManager.
 *
 * Two behaviors worth pinning:
 *
 * 1. AddStageForm's post-success reset runs in an effect, not in the
 *    render body. The old code mutated the useActionState object
 *    (`state.values = {}`) and queued a setState during render — this
 *    suite pins that the action's returned state survives untouched
 *    and that the inputs still clear after a successful add (and
 *    clear AGAIN on a second success, which requires the effect to
 *    depend on the state object, not the status string).
 *
 * 2. The row-level IconButtons (move / archive) live INSIDE the
 *    StageRow rename <form>. They must be type="button" — a submit
 *    type would fire the rename action (`updateStage`) on every
 *    move/archive click.
 *
 * Server actions are stubbed at the module level so no DB is needed.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the server actions BEFORE importing the component so its
// imports resolve to the mocks.
vi.mock("@/app/actions/practice-areas", () => ({
  createStage: vi.fn(),
  moveStage: vi.fn(),
  setStageActive: vi.fn(),
  updateStage: vi.fn(),
}));

import {
  createStage,
  moveStage,
  setStageActive,
  updateStage,
} from "@/app/actions/practice-areas";
import { StageManager, type StageManagerStage } from "./stage-manager";

const mockedCreate = vi.mocked(createStage);
const mockedMove = vi.mocked(moveStage);
const mockedSetActive = vi.mocked(setStageActive);
const mockedUpdate = vi.mocked(updateStage);

const stage = (
  over: Partial<StageManagerStage> = {}
): StageManagerStage => ({
  id: "st_1",
  name: "Intake",
  order: 0,
  isTerminal: false,
  isActive: true,
  matterCount: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Fresh object per call — mirrors real server actions, whose
  // return value is deserialized over the wire and never
  // reference-equal across submissions. A shared object would let
  // React bail out on Object.is-equal state and mask the
  // depend-on-the-state-OBJECT behavior pinned below.
  mockedCreate.mockImplementation(async () => ({ status: "ok" as const }));
  mockedSetActive.mockResolvedValue({ ok: true });
  mockedMove.mockResolvedValue({ ok: true });
});

const nameInput = () =>
  screen.getByPlaceholderText(/new stage name/i) as HTMLInputElement;

describe("AddStageForm — reset after successful add", () => {
  test("clears the inputs once the action reports ok", async () => {
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    await user.type(nameInput(), "Mediation");
    await user.click(screen.getByRole("button", { name: /add stage/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce());
    // Bound arg — the action is practiceAreaId-bound via .bind().
    expect(mockedCreate.mock.calls[0][0]).toBe("pa_1");
    // Key bump remounted the form with empty defaults.
    await waitFor(() => expect(nameInput().value).toBe(""));
  });

  test("resets again on a second consecutive success", async () => {
    // Requires the reset effect to key on the state OBJECT: after
    // the first success the status is "ok" forever, so a
    // `state.status` dependency would never re-fire.
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    await user.type(nameInput(), "Mediation");
    await user.click(screen.getByRole("button", { name: /add stage/i }));
    await waitFor(() => expect(nameInput().value).toBe(""));

    await user.type(nameInput(), "Arbitration");
    await user.click(screen.getByRole("button", { name: /add stage/i }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(nameInput().value).toBe(""));
  });

  test("does not mutate the action-state object", async () => {
    // The old render-body reset emptied `state.values` in place —
    // any future consumer of the returned state would silently see
    // {}. Pin that the object comes back from the action untouched.
    const okState = {
      status: "ok" as const,
      values: { name: "Mediation" },
    };
    mockedCreate.mockResolvedValue(okState);
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    await user.type(nameInput(), "Mediation");
    await user.click(screen.getByRole("button", { name: /add stage/i }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce());

    // Re-render (key bump) has happened by the time the input is
    // re-seeded from state.values — the object must still be whole.
    await waitFor(() => expect(nameInput().value).toBe("Mediation"));
    expect(okState.values).toEqual({ name: "Mediation" });
  });

  test("surfaces field errors on a failed add", async () => {
    mockedCreate.mockResolvedValue({
      status: "error",
      errors: { name: ["A stage with that name already exists in this area"] },
      values: { name: "Intake" },
    });
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    await user.type(nameInput(), "Intake");
    await user.click(screen.getByRole("button", { name: /add stage/i }));

    expect(
      await screen.findByText(/already exists in this area/)
    ).toBeInTheDocument();
  });
});

describe("StageRow — icon buttons must not submit the rename form", () => {
  test("archive fires setStageActive without triggering updateStage", async () => {
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(mockedSetActive).toHaveBeenCalledWith("st_1", false)
    );
    // A submit-typed button would have fired the row's rename form.
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  test("move down fires moveStage without triggering updateStage", async () => {
    const user = userEvent.setup();
    render(
      <StageManager
        practiceAreaId="pa_1"
        stages={[
          stage(),
          stage({ id: "st_2", name: "Discovery", order: 1 }),
        ]}
      />
    );

    // First row's "Move down" (second row's is disabled at the end).
    await user.click(
      screen.getAllByRole("button", { name: "Move down" })[0]
    );

    await waitFor(() =>
      expect(mockedMove).toHaveBeenCalledWith("st_1", "down")
    );
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
