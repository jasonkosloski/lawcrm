/**
 * Save-and-resume for the /matters/new form.
 *
 * Auto-saves every 30 s, only for an existing draft (the first save is
 * the user's "Save draft" click or the first file attach) and only when
 * the serialized values changed since the last save. Saves are queued
 * one at a time so two never race on `updatedAt`.
 *
 * - `paused` (set while Create is in flight): no auto-save fires, so a
 *   save can't land between the claim and the redirect. The server never
 *   creates from an id either, so a late save can't resurrect the draft.
 * - `notfound` -> "gone": a teammate deleted the draft or opened a
 *   matter from it. Saving stops; nothing is silently re-created.
 * - `stale` -> someone else saved first. Saving stops until reload.
 * - `invalid` -> the draft is too large to save. Auto-save stops.
 * - `error` (thrown / network) -> shown; the next change retries.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveMatterDraft, type DraftValues } from "@/app/actions/matter-drafts";

export const AUTOSAVE_INTERVAL_MS = 30_000;

export type AutosaveStatus = "idle" | "saving" | "saved" | "stale" | "gone" | "error" | "invalid";

export function useDraftAutosave({
  draftId,
  updatedAt,
  getValues,
  paused,
}: {
  draftId: string | null;
  updatedAt: string | null;
  getValues: () => DraftValues;
  paused: boolean;
}) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(
    updatedAt ? new Date(updatedAt) : null
  );
  const [current, setCurrent] = useState({ draftId, updatedAt });

  const idRef = useRef(draftId);
  const updatedAtRef = useRef(updatedAt);
  const lastJsonRef = useRef<string | null>(null);
  const blockedRef = useRef(false);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const savingRef = useRef(0);
  const getValuesRef = useRef(getValues);
  const pausedRef = useRef(paused);

  useEffect(() => {
    getValuesRef.current = getValues;
    pausedRef.current = paused;
  });

  // Baseline: what the form shows on mount is what the draft holds.
  useEffect(() => {
    if (idRef.current) lastJsonRef.current = JSON.stringify(getValuesRef.current());
  }, []);

  const doSave = useCallback(async (force: boolean): Promise<string | null> => {
    if (blockedRef.current || pausedRef.current) return null;
    const values = getValuesRef.current();
    const json = JSON.stringify(values);
    if (!force && json === lastJsonRef.current) return idRef.current;
    setStatus("saving");
    try {
      const res = await saveMatterDraft(idRef.current, updatedAtRef.current, values);
      if (res.ok) {
        idRef.current = res.draftId;
        updatedAtRef.current = res.updatedAt;
        lastJsonRef.current = json;
        setCurrent({ draftId: res.draftId, updatedAt: res.updatedAt });
        setSavedAt(new Date(res.updatedAt));
        setStatus("saved");
        return res.draftId;
      }
      if (res.code === "notfound") {
        blockedRef.current = true;
        setStatus("gone");
      } else if (res.code === "stale") {
        blockedRef.current = true;
        setStatus("stale");
      } else {
        blockedRef.current = true;
        setStatus("invalid");
      }
      return null;
    } catch {
      setStatus("error");
      return null;
    }
  }, []);

  const run = useCallback(
    (force: boolean): Promise<string | null> => {
      savingRef.current += 1;
      const p = queueRef.current.then(() => doSave(force));
      queueRef.current = p.then(
        () => undefined,
        () => undefined
      );
      return p.finally(() => {
        savingRef.current -= 1;
      });
    },
    [doSave]
  );

  useEffect(() => {
    const t = setInterval(() => {
      if (!idRef.current || blockedRef.current || pausedRef.current) return;
      void run(false);
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [run]);

  return {
    status,
    savedAt,
    draftId: current.draftId,
    updatedAt: current.updatedAt,
    /** Save now (the "Save draft" button / first attach). Resolves the
     *  draft id, or null when it couldn't be saved. */
    saveNow: () => run(true),
    /** Resolves once any queued save has landed. */
    settled: () => queueRef.current.then(() => undefined),
    isSaving: () => savingRef.current > 0,
    /** The freshest `updatedAt`, for a submit that raced a save. */
    latestUpdatedAt: () => updatedAtRef.current,
  };
}
