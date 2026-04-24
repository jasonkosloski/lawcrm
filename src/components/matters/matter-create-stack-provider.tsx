/**
 * Matter Create Stack Provider
 *
 * Owns the list of open Create panels for a matter, plus which one is
 * focused and whether the focused panel is expanded-to-modal. Lives in
 * the matter detail layout so its state survives tab navigation.
 *
 * Why a provider instead of URL state: multiple concurrent panels
 * don't serialize cleanly into query params, and once you need a
 * minimized chip list, URL roundtrips fight the interaction model.
 * Deep-linking to a specific create state is deferred.
 *
 * Real form state (once v1 placeholders get replaced with real forms)
 * will live here too — keyed by panel id in `panelFormState`. Keeping
 * form data in the provider rather than the panel component means
 * panels can freely mount/unmount as they gain or lose focus without
 * losing the user's work.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MatterCreateType } from "@/lib/matter-create-types";

/** A single open Create panel. */
export type CreatePanel = {
  id: string;
  type: MatterCreateType;
  expanded: boolean;
  /** Free-form form state for when real forms land. Currently unused. */
  formState: Record<string, unknown>;
};

export type MatterMeta = {
  matterId: string;
  matterName: string;
  matterCaseNumber: string | null;
  matterColor: string;
};

type StackContext = MatterMeta & {
  panels: CreatePanel[];
  focusedId: string | null;
  /** Open a new panel of `type`. Minimizes the currently focused panel
   *  (if any) and makes the new one focused. */
  open: (type: MatterCreateType) => void;
  /** Remove a panel entirely. If it was focused, focus shifts to the
   *  next most recent panel, or null. */
  close: (id: string) => void;
  /** Bring a panel to focus. Collapses any expanded panel first. */
  focus: (id: string) => void;
  /** Toggle expand-to-modal on the focused panel. */
  setExpanded: (id: string, expanded: boolean) => void;
  /** Merge a patch into a panel's form state. */
  updateFormState: (id: string, patch: Record<string, unknown>) => void;
};

const Ctx = createContext<StackContext | null>(null);

let idCounter = 0;
const nextId = (): string =>
  `panel-${++idCounter}-${Date.now().toString(36)}`;

export function MatterCreateStackProvider({
  matterId,
  matterName,
  matterCaseNumber,
  matterColor,
  children,
}: MatterMeta & { children: ReactNode }) {
  const [panels, setPanels] = useState<CreatePanel[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const open = useCallback((type: MatterCreateType) => {
    const id = nextId();
    setPanels((prev) => [
      ...prev,
      { id, type, expanded: false, formState: {} },
    ]);
    setFocusedId(id);
  }, []);

  const close = useCallback((id: string) => {
    setPanels((prev) => {
      const next = prev.filter((p) => p.id !== id);
      // Focus shift: if we just removed the focused panel, pick the
      // most recently-opened remaining panel (last in list).
      setFocusedId((currentFocus) => {
        if (currentFocus !== id) return currentFocus;
        return next.length > 0 ? next[next.length - 1].id : null;
      });
      return next;
    });
  }, []);

  const focus = useCallback((id: string) => {
    // Collapse any expanded panels when switching focus; expansion is
    // a focus-mode for one panel at a time.
    setPanels((prev) => prev.map((p) => ({ ...p, expanded: false })));
    setFocusedId(id);
  }, []);

  const setExpanded = useCallback((id: string, expanded: boolean) => {
    setPanels((prev) =>
      prev.map((p) => (p.id === id ? { ...p, expanded } : p))
    );
    if (expanded) setFocusedId(id);
  }, []);

  const updateFormState = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setPanels((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, formState: { ...p.formState, ...patch } } : p
        )
      );
    },
    []
  );

  const value = useMemo<StackContext>(
    () => ({
      matterId,
      matterName,
      matterCaseNumber,
      matterColor,
      panels,
      focusedId,
      open,
      close,
      focus,
      setExpanded,
      updateFormState,
    }),
    [
      matterId,
      matterName,
      matterCaseNumber,
      matterColor,
      panels,
      focusedId,
      open,
      close,
      focus,
      setExpanded,
      updateFormState,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMatterCreateStack(): StackContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useMatterCreateStack must be used within MatterCreateStackProvider"
    );
  }
  return ctx;
}
