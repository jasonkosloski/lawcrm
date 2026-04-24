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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CommandPalette } from "./command-palette";

type PaletteContextValue = {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
};

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const togglePalette = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCmdK =
        (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (isCmdK) {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePalette]);

  return (
    <PaletteContext.Provider
      value={{ open, openPalette, closePalette, togglePalette }}
    >
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
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
    throw new Error(
      "useCommandPalette must be used within CommandPaletteProvider"
    );
  }
  return ctx;
}
