// @vitest-environment happy-dom
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
 *
 * Submissions are dispatched inside `startTransition`, exactly like
 * `<form action>` does. Calling a useActionState dispatch outside a
 * transition logs "An async function with useActionState was called
 * outside of a transition" and leaves isPending false, so the
 * transition path (and the hook's `anchor` companion update) would
 * go untested. console.error is spied on and asserted clean.
 */

import { startTransition } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  // No "called outside of a transition" (or any other React) errors.
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

type HookResult = {
  current: ReturnType<typeof useDialogActionState<TestState, TestState>>;
};

const submit = async (result: HookResult, payload: TestState) => {
  await act(async () => {
    startTransition(() => {
      result.current[1](payload);
    });
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

  test("isPending is true while the action is unresolved and false after it settles", async () => {
    let settle: (v: TestState) => void = () => {};
    const slow = () =>
      new Promise<TestState>((resolve) => {
        settle = resolve;
      });
    const { result } = renderHook(() =>
      useDialogActionState<TestState, TestState>(slow, initial, true)
    );
    expect(result.current[2]).toBe(false);

    await act(async () => {
      startTransition(() => {
        result.current[1]({ status: "ok" });
      });
    });
    expect(result.current[2]).toBe(true);
    // Still masked to initial while pending — nothing has landed.
    expect(result.current[0]).toBe(initial);

    await act(async () => {
      settle({ status: "ok" });
    });
    expect(result.current[2]).toBe(false);
    expect(result.current[0]).toEqual({ status: "ok" });
  });
});
