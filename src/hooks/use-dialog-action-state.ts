/**
 * useDialogActionState — useActionState for dialogs and collapsible
 * composers that stay MOUNTED across close/reopen.
 *
 * React's useActionState keeps its last state forever and has no
 * reset API. Row menus and tab surfaces render their dialog /
 * composer unconditionally, so only the *content* unmounts on close
 * — the hook's state survives. Without intervention, a failed
 * attempt's error banner (and its field errors) reappears the next
 * time the surface opens, looking like a live failure; a stale
 * success could likewise re-fire close/reset effects.
 *
 * This wrapper snapshots the action state that already existed when
 * the open/expanded flag last flipped and exposes `initialState` in
 * its place until a NEW state object arrives. Server actions return
 * a fresh object per submission (the value is deserialized over the
 * wire, so it's never reference-equal across submissions), which
 * makes identity comparison the reliable "a submission finished in
 * THIS session" signal:
 *
 *   - stale error from a previous open   → masked, no banner
 *   - stale success from a previous open → masked, no re-close/reset
 *   - fresh success/error after reopen   → exposed as usual, so
 *     close-on-success effects keyed on the state OBJECT still fire
 *
 * Success-close effects must keep keying on the state object (not
 * `state.status`) — see RecordPaymentDialog for the full rationale;
 * this hook preserves that contract because the masked value only
 * changes identity when a submission lands or the flag flips.
 *
 * `initialState` must be referentially stable (a module constant
 * like `billingInitialState`). A fresh literal per render would
 * defeat the identity masking and re-trigger [state]-keyed effects.
 */

"use client";

import { useActionState, useCallback, useRef, useState } from "react";

export function useDialogActionState<State, Payload = FormData>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
  /** The dialog's `open` prop or the composer's `expanded` flag. */
  open: boolean
): [
  state: Awaited<State>,
  formAction: (payload: Payload) => void,
  isPending: boolean,
] {
  const [, anchor] = useState(0);
  const anchoredAction = useCallback(
    async (prev: Awaited<State>, payload: Payload) => {
      const next = await action(prev, payload);
      // Companion update in the same transition as the action-state
      // update. React 19 (observed on 19.2.4) can drop the
      // post-action re-render entirely when the form content was
      // remounted (dialog close → reopen) and no other state has
      // changed since — the fresh state object then never renders,
      // so neither the new banner nor a close-on-success effect
      // fires. (Same trap EditTimeEntryDialog documents; its
      // close-inside-the-action workaround can't surface errors,
      // this one can.) An always-changing counter anchors the
      // commit so the action state reliably lands.
      anchor((n) => n + 1);
      return next;
    },
    [action]
  );

  const [state, formAction, isPending] = useActionState(
    anchoredAction,
    initialState
  );

  // Baseline = the action state that already existed when `open`
  // last flipped. Re-captured on BOTH transitions during render
  // (idempotent ref write — an effect would let the stale banner
  // paint for one frame before clearing; render-phase setState
  // interferes with the action transition and re-triggers the
  // dropped-commit bug above).
  const baselineRef = useRef({ open, state });
  if (open !== baselineRef.current.open) {
    baselineRef.current = { open, state };
  }

  // Anything identical to the baseline predates this open session —
  // expose the initial state instead.
  return [
    state === baselineRef.current.state ? initialState : state,
    formAction,
    isPending,
  ];
}
