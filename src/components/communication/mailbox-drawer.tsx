/**
 * MailboxDrawer — mobile slide-out wrapper for the communication
 * mailbox/folder rails (email + messenger).
 *
 * Pattern mirrors the main app sidebar (MobileNavProvider /
 * SidebarNav drawer): below `lg` the rail is a hidden overlay
 * that slides in from the left when the trigger is tapped; at
 * `lg+` it's a persistent column with no transition.
 *
 * Three exports keep the rail components themselves untouched
 * (still server components, fed by server-side queries):
 *
 *   - MailboxDrawerProvider — state owner (open / close / toggle).
 *     Wrap the communication page in this.
 *   - MailboxDrawerTrigger — hamburger-shaped button. Place in the
 *     thread list header so it lives where the user is on mobile.
 *   - MailboxDrawer — drawer shell that renders the rail. Pass the
 *     server-rendered rail as `children`.
 *
 * The drawer auto-closes when the user navigates (route change)
 * because picking a folder is the whole reason they opened it.
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
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

type MailboxDrawerContextValue = {
  open: boolean;
  toggle: () => void;
  close: () => void;
};

const MailboxDrawerContext = createContext<MailboxDrawerContextValue | null>(
  null
);

function useMailboxDrawer(): MailboxDrawerContextValue {
  const ctx = useContext(MailboxDrawerContext);
  if (!ctx) {
    throw new Error(
      "MailboxDrawer components must be used inside MailboxDrawerProvider"
    );
  }
  return ctx;
}

export function MailboxDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  const close = useCallback(() => setOpen(false), []);

  // Close on route change OR query change (filter pick =
  // ?filter=X). Watching both ensures the drawer dismisses when
  // the user picks a folder, which doesn't change the path.
  useEffect(() => {
    setOpen(false);
  }, [pathname, searchParams]);

  // Esc closes; lock body scroll while open. Same hygiene as
  // the main sidebar drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <MailboxDrawerContext.Provider value={{ open, toggle, close }}>
      {children}
    </MailboxDrawerContext.Provider>
  );
}

/** Hamburger-style trigger button — visible only below `lg`. Place
 *  in the thread-list header so it sits next to the active
 *  filter's label. */
export function MailboxDrawerTrigger({ label }: { label: string }) {
  const { toggle } = useMailboxDrawer();
  return (
    <button
      type="button"
      onClick={toggle}
      title={`Switch folder (current: ${label})`}
      aria-label="Open folder list"
      className="lg:hidden inline-flex items-center justify-center w-8 h-8 -ml-1 rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink shrink-0"
    >
      <Menu size={16} />
    </button>
  );
}

/** Drawer shell. Wraps the rail (passed as children). At `lg+` it
 *  renders the rail unchanged — server-side bg + width + border
 *  classes on the rail itself decide how it looks. Below `lg` it
 *  becomes a fixed-position drawer with backdrop. */
export function MailboxDrawer({ children }: { children: ReactNode }) {
  const { open, close } = useMailboxDrawer();
  return (
    <>
      {/* Backdrop (mobile only). */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-ink/40 transition-opacity lg:hidden",
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
        aria-hidden={!open}
        onClick={close}
      />
      {/* Drawer container. At lg+ it sits in the normal flex flow
          (`lg:static lg:translate-x-0`). Below lg it's a fixed
          off-canvas panel that slides in. The rail's own width +
          background + border classes do the rest.
          Solid `bg-card` here — the rail itself uses `bg-paper-2/30`
          which looks fine layered over the page at lg+ but reads
          as a ghosty translucent overlay on mobile where there's
          page content + backdrop directly behind. The bg is
          dropped at lg+ via `lg:bg-transparent` so the rail's own
          translucent design surfaces normally on desktop. */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col transition-transform lg:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:translate-x-0 lg:z-auto",
          "bg-card lg:bg-transparent shadow-2xl lg:shadow-none"
        )}
        aria-hidden={!open ? undefined : false}
      >
        {/* Close button — mobile only. Positioned in the rail's
            top-right so it sits at the user's thumb. */}
        <button
          type="button"
          onClick={close}
          className="lg:hidden absolute top-2 right-2 z-10 inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink"
          title="Close folder list"
          aria-label="Close folder list"
        >
          <X size={14} />
        </button>
        {children}
      </div>
    </>
  );
}
