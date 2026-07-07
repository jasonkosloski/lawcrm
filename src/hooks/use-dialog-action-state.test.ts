/**
 * Tests for useDialogActionState.
 *
 * The contract under test: state left over from a previous open
 * session is masked back to `initialState`, while state produced by
 * a submission in the CURRENT session is exposed — including its
 * object identity, which close-on-success effects key on.
 *
 * The mock action returns a FRESH object per call, mirroring real
 * server actions (their return value is deserialized over the wire
 * and is never reference-equal across submissions). Reusing one
 * object would mask the very identity semantics the hook relies on.
 */

import { describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDialogActionState } from "./use-dialog-action-state";

type TestState = { status: "idle" | "ok" | "error"; error?: string };

// Module-constant initial state — the hook requires referential
// stability, same as billingInitialState & friends in the app.
const initial: TestState = { status: "idle" };

// Payload doubles as the scripted outcome so each test drives the
// action without shared mutable mocks.
const action = async (
  _prev: TestState,
  payload: TestState
): Promise<TestState> => ({ ...payload });

const setup = (open = true) =>
  renderHook(
    ({ open }: { open: boolean }) =>
      useDialogActionState<TestState, TestState>(action, initial, open),
    { initialProps: { open } }
  );

const submit = async (
  result: { current: ReturnType<typeof useDialogActionState<TestState, TestState>> },
  payload: TestState
) => {
  await act(async () => {
    result.current[1](payload);
  });
};

describe("useDialogActionState", () => {
  test("exposes the initial state (by identity) before any submission", () => {
    const { result } = setup();
    expect(result.current[0]).toBe(initial);
  });

  test("exposes a fresh submission's state within the same session", async () => {
    const { result } = setup();
    await submit(result, { status: "error", error: "Boom" });
    expect(result.current[0]).toEqual({ status: "error", error: "Boom" });
  });

  test("masks a stale error after close → reopen", async () => {
    const { result, rerender } = setup();
    await submit(result, { status: "error", error: "Boom" });

    rerender({ open: false });
    rerender({ open: true });

    // The old error predates this open session — masked back to the
    // initial state so no banner renders.
    expect(result.current[0]).toBe(initial);
  });

  test("exposes a NEW error submitted after reopening", async () => {
    const { result, rerender } = setup();
    await submit(result, { status: "error", error: "First" });
    rerender({ open: false });
    rerender({ open: true });

    await submit(result, { status: "error", error: "Second" });
    expect(result.current[0]).toEqual({ status: "error", error: "Second" });
  });

  test("masks a stale success so close/reset effects can't re-fire", async () => {
    const { result, rerender } = setup();
    await submit(result, { status: "ok" });
    expect(result.current[0]).toEqual({ status: "ok" });

    // Dialog closed on that success; reopening must NOT re-expose it.
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current[0]).toBe(initial);
  });

  test("a second success after reopen is exposed with a new identity", async () => {
    // The regression the identity contract exists for: success →
    // close → reopen → success again must surface a distinct object
    // so [state]-keyed close effects fire a second time.
    const { result, rerender } = setup();
    await submit(result, { status: "ok" });
    const first = result.current[0];

    rerender({ open: false });
    rerender({ open: true });

    await submit(result, { status: "ok" });
    const second = result.current[0];
    expect(second).toEqual({ status: "ok" });
    expect(second).not.toBe(first);
    expect(second).not.toBe(initial);
  });

  test("state arriving while closed is masked once reopened", async () => {
    // Submit, then close before looking at the result — e.g. the
    // user hits Cancel while a save is in flight. The late result
    // must not haunt the next session.
    const { result, rerender } = setup();
    await submit(result, { status: "error", error: "Late" });
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current[0]).toBe(initial);
  });
});
