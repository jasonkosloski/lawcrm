/**
 * MobileNavProvider — coordinates the mobile sidebar drawer.
 *
 * The sidebar lives in two modes:
 *   - Persistent column at `lg` and up (≥1024px). Always visible,
 *     no toggle needed.
 *   - Overlay drawer below `lg`. Hidden by default; opens when the
 *     user taps the hamburger in the topbar.
 *
 * Both the topbar (which owns the hamburger) and the sidebar
 * (which renders as a drawer or persistent column depending on
 * `open`) need to coordinate. A simple context with `open`,
 * `toggle`, `close` is the cheapest shape.
 *
 * The drawer also closes:
 *   - When a nav link is tapped (so a fresh tap re-opens it next time)
 *   - When the user presses Escape
 *   - When the user taps the backdrop
 *
 * Auto-close on route change: the SidebarNav itself watches the
 * pathname and calls `close()` after navigation. Doing it there
 * keeps the provider plain.
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

type MobileNavContextValue = {
  open: boolean;
  toggle: () => void;
  close: () => void;
};

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  const close = useCallback(() => setOpen(false), []);

  // Esc closes the drawer (mobile/tablet only — at lg+ the sidebar
  // is persistent and `open` doesn't affect rendering).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll while the drawer is open so the page behind
  // the backdrop doesn't scroll under tap. Restored on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <MobileNavContext.Provider value={{ open, toggle, close }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav(): MobileNavContextValue {
  const ctx = useContext(MobileNavContext);
  if (!ctx) {
    throw new Error("useMobileNav must be used inside MobileNavProvider");
  }
  return ctx;
}
