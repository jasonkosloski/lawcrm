/** Event Detail Modal — the accessible dialog shell. */

"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// ── Dialog shell ────────────────────────────────────────────────────────

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const EDITABLE = 'input, textarea, select, [contenteditable="true"]';

/** Backdrop + role=dialog container shared by the full and Busy
 *  views. Handles what a real modal must: focus moves into the dialog
 *  on open, Tab is trapped inside it, focus returns to the opener on
 *  close, and Escape closes it, without swallowing an Escape aimed at
 *  something else (a docked composer's field) and without discarding a
 *  half-typed note (inside `[data-modal-composer]` the first Escape
 *  just blurs). */
export function ModalShell({
  label,
  widthClass,
  onClose,
  children,
}: {
  label: string;
  widthClass: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (opener && opener !== document.body && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    // Listens on `document`, not `window`, so handling Escape here
    // (stopPropagation) keeps it from also reaching other window-level
    // Escape handlers such as the create dock's.
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      const onPage =
        !target || target === document.body || target === document.documentElement;
      const inside = !!target && !!rootRef.current?.contains(target);
      // Focus is somewhere else on the page (e.g. a docked composer):
      // that surface owns this Escape.
      if (!inside && !onPage) return;
      e.preventDefault();
      e.stopPropagation();
      if (inside && target.closest("[data-modal-composer]") && target.matches(EDITABLE)) {
        (target as HTMLElement).blur();
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE)
    ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div ref={rootRef} className="contents">
      <button
        type="button"
        aria-label="Close event"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm cursor-default animate-in fade-in duration-100"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn(
          "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl shadow-2xl ring-1 ring-black/5 border border-line bg-white flex flex-col overflow-hidden outline-none animate-in zoom-in-95 fade-in duration-100",
          widthClass
        )}
      >
        {children}
      </div>
    </div>
  );
}
