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

  const close = useCallback(
    (id: string) => {
      const closingFocused = id === focusedId;
      const closingPanel = panels.find((p) => p.id === id);
      // If the user is closing the focused panel *while it's expanded*,
      // the next focused panel inherits that expansion — the user is in
      // "focus mode" and doesn't want to be dumped back to the docked
      // rail just because they closed one item in the stack.
      const inheritExpanded =
        closingFocused && (closingPanel?.expanded ?? false);

      const remaining = panels.filter((p) => p.id !== id);
      const nextFocusId = closingFocused
        ? remaining.length > 0
          ? remaining[remaining.length - 1].id
          : null
        : focusedId;

      setPanels(
        remaining.map((p) =>
          inheritExpanded && p.id === nextFocusId
            ? { ...p, expanded: true }
            : p
        )
      );
      setFocusedId(nextFocusId);
    },
    [panels, focusedId]
  );

  const focus = useCallback(
    (id: string) => {
      // Chip-click focus preserves expansion: if the current focused
      // panel is expanded, hand the expansion to the newly-focused
      // panel so the user stays in modal focus mode across switches.
      // If the current is docked, the new one is docked too.
      setPanels((prev) => {
        const currentlyExpanded =
          prev.find((p) => p.id === focusedId)?.expanded ?? false;
        return prev.map((p) => ({
          ...p,
          expanded: p.id === id ? currentlyExpanded : false,
        }));
      });
      setFocusedId(id);
    },
    [focusedId]
  );

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
