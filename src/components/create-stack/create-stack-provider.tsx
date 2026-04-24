/**
 * Create Stack Provider
 *
 * Generic stack of "+ Create …" panels that survive navigation within
 * the layout they're mounted in. Used by the matter detail layout
 * (where panels capture notes, time entries, deadlines, etc. for a
 * matter) and by the calendar page (where the only panel type is
 * `event`). Any page that wants a Gmail-compose-style docked create
 * flow can wrap its subtree in this provider.
 *
 * The `context` prop is optional — when present, it drives the
 * expanded-mode context strip (shown inside the modal chrome to remind
 * the user what they're creating against). Matter detail passes
 * matter color + name + case number; calendar passes nothing.
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

export type CreatePanel = {
  id: string;
  type: MatterCreateType;
  expanded: boolean;
  formState: Record<string, unknown>;
};

/** Optional metadata shown in expanded-mode modal chrome so the user
 *  knows what context the create is scoped to. Matter-scoped stacks
 *  pass `matterId` so typed panels (e.g. note) can attach the created
 *  record to the right matter without having to look at the URL. */
export type CreateContext = {
  /** Matter id when the stack is scoped to a matter; null on pages
   *  like calendar where panels aren't tied to a single matter. */
  matterId?: string | null;
  /** Dot color — e.g. matter practice-area color. */
  color: string;
  /** Primary label — e.g. matter name. */
  label: string;
  /** Secondary label — e.g. case number; shown monospaced. */
  sublabel: string | null;
};

type StackContextValue = {
  panels: CreatePanel[];
  focusedId: string | null;
  context: CreateContext | null;
  open: (type: MatterCreateType) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  updateFormState: (id: string, patch: Record<string, unknown>) => void;
};

const Ctx = createContext<StackContextValue | null>(null);

let idCounter = 0;
const nextId = (): string =>
  `panel-${++idCounter}-${Date.now().toString(36)}`;

export function CreateStackProvider({
  context = null,
  children,
}: {
  context?: CreateContext | null;
  children: ReactNode;
}) {
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
      // If the user closes the focused panel *while it's expanded*, the
      // next focused panel inherits the expansion — they're in focus
      // mode and shouldn't be kicked back to the docked rail.
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

  const value = useMemo<StackContextValue>(
    () => ({
      context,
      panels,
      focusedId,
      open,
      close,
      focus,
      setExpanded,
      updateFormState,
    }),
    [
      context,
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

export function useCreateStack(): StackContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useCreateStack must be used within CreateStackProvider");
  }
  return ctx;
}
