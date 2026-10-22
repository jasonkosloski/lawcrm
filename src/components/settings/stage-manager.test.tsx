/**
 * Tests for StageManager.
 *
 * Two behaviors worth pinning:
 *
 * 1. AddStageForm's inputs are controlled (the form submits through
 *    onSubmit + startTransition, so React 19's automatic form reset
 *    never runs) and are cleared explicitly after a successful add —
 *    keyed on the state OBJECT so a second consecutive success clears
 *    again — while a validation error keeps what was typed. There is
 *    no remount, so focus stays in the name field. The action's
 *    returned state must survive untouched.
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

import { createStage, moveStage, setStageActive, updateStage } from "@/app/actions/practice-areas";
import { StageManager, type StageManagerStage } from "./stage-manager";

const mockedCreate = vi.mocked(createStage);
const mockedMove = vi.mocked(moveStage);
const mockedSetActive = vi.mocked(setStageActive);
const mockedUpdate = vi.mocked(updateStage);

const stage = (over: Partial<StageManagerStage> = {}): StageManagerStage => ({
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

const nameInput = () => screen.getByPlaceholderText(/new stage name/i) as HTMLInputElement;

describe("AddStageForm — reset after successful add", () => {
  test("clears the inputs once the action reports ok", async () => {
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    await user.type(nameInput(), "Mediation");
    await user.click(screen.getByRole("button", { name: /add stage/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce());
    // Bound arg — the action is practiceAreaId-bound via .bind().
    expect(mockedCreate.mock.calls[0][0]).toBe("pa_1");
    // Controlled inputs were cleared after the ok state.
    await waitFor(() => expect(nameInput().value).toBe(""));
  });

  test("keeps the same input element (no remount) so Enter-to-add keeps focus", async () => {
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    const before = nameInput();
    await user.type(before, "Mediation{Enter}");
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce());
    await waitFor(() => expect(nameInput().value).toBe(""));
    expect(nameInput()).toBe(before);
    expect(document.activeElement).toBe(before);
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

    // The input clears on success; the returned object must still be whole.
    await waitFor(() => expect(nameInput().value).toBe(""));
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

    expect(await screen.findByText(/already exists in this area/)).toBeInTheDocument();
  });
});

describe("StageRow — icon buttons must not submit the rename form", () => {
  test("archive fires setStageActive without triggering updateStage", async () => {
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(mockedSetActive).toHaveBeenCalledWith("st_1", false));
    // A submit-typed button would have fired the row's rename form.
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  test("move down fires moveStage without triggering updateStage", async () => {
    const user = userEvent.setup();
    render(
      <StageManager
        practiceAreaId="pa_1"
        stages={[stage(), stage({ id: "st_2", name: "Discovery", order: 1 })]}
      />,
    );

    // First row's "Move down" (second row's is disabled at the end).
    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]);

    await waitFor(() => expect(mockedMove).toHaveBeenCalledWith("st_1", "down"));
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});

describe("accessible names", () => {
  test("row name input, row terminal checkbox and add-form input are labelled", () => {
    render(<StageManager practiceAreaId="pa_1" stages={[stage({ isTerminal: true })]} />);
    expect(screen.getByLabelText("Stage name (Intake)")).toBeTruthy();
    expect((screen.getByLabelText("Intake is terminal") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("New stage name")).toBeTruthy();
  });
});

describe("stage forms after a server validation error", () => {
  test("StageRow keeps the edited name and terminal checkbox", async () => {
    mockedUpdate.mockImplementation(async () => ({
      status: "error" as const,
      errors: { name: ["A stage with that name already exists"] },
      values: {},
    }));
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    const rowName = screen.getByDisplayValue("Intake") as HTMLInputElement;
    await user.clear(rowName);
    await user.type(rowName, "Dup");
    const terminal = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    await user.click(terminal);
    await user.click(screen.getByTitle(/save changes/i));

    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeTruthy());
    expect((screen.getByDisplayValue("Dup") as HTMLInputElement).value).toBe("Dup");
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
  });

  test("AddStageForm keeps the typed name and terminal checkbox on error", async () => {
    mockedCreate.mockImplementation(async () => ({
      status: "error" as const,
      errors: { name: ["A stage with that name already exists"] },
      values: {},
    }));
    const user = userEvent.setup();
    render(<StageManager practiceAreaId="pa_1" stages={[stage()]} />);

    await user.type(nameInput(), "Mediation");
    await user.click(screen.getByLabelText("terminal"));
    await user.click(screen.getByRole("button", { name: /add stage/i }));

    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeTruthy());
    expect(nameInput().value).toBe("Mediation");
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[boxes.length - 1].checked).toBe(true);
  });
});
