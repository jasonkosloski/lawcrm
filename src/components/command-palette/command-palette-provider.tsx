/**
 * Command Palette Provider
 *
 * Owns the palette's open state and registers the global ⌘K / Ctrl+K
 * handler. Child components can access `useCommandPalette()` to open
 * the palette (e.g. from the sidebar's ⌘K button).
 *
 * Mount this once inside `AppShell` so it wraps every authenticated
 * page.
 */

"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// cmdk, the dialog and ~20 icons are only needed once the palette is
// first opened — keep them out of every page's initial bundle.
const CommandPalette = dynamic(() => import("./command-palette").then((m) => m.CommandPalette), {
  ssr: false,
});

type PaletteContextValue = {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
};

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Mount the (lazy) palette on first open and keep it mounted so
  // closing/reopening is instant and its state survives.
  const [everOpened, setEverOpened] = useState(false);
  if (open && !everOpened) setEverOpened(true);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const togglePalette = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (isCmdK) {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePalette]);

  return (
    <PaletteContext.Provider value={{ open, openPalette, closePalette, togglePalette }}>
      {children}
      {everOpened && <CommandPalette open={open} onOpenChange={setOpen} />}
    </PaletteContext.Provider>
  );
}

/**
 * Access the command palette from anywhere inside the provider. Throws
 * if called outside — consumers are always rendered inside `AppShell`,
 * so a missing provider is a programming error worth surfacing loudly.
 */
export function useCommandPalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext);
  if (!ctx) {
    throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  }
  return ctx;
}
