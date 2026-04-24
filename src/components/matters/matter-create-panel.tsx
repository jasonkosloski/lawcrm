/**
 * Matter Create Panel
 *
 * Right-docked sidebar for the "+ Create …" flow on matter detail
 * pages. Controlled by a `?create=<type>` URL param so links can
 * deep-link into a specific form AND the panel persists across
 * in-matter tab navigation.
 *
 * Two display modes:
 *   - **Docked** (default): right-rail sidebar, main content stays
 *     interactive — user can navigate tabs while the form stays open
 *   - **Expanded**: modal-sized floating panel with backdrop, for
 *     focus work. Triggered by `?create=<type>&expanded=1`.
 *
 * Persistence across modes: the same `<aside>` element is rendered in
 * both modes, only position classes swap. React doesn't remount the
 * subtree on className changes, so any form state inside the panel
 * survives docked ↔ expanded transitions.
 *
 * Persistence across tabs: this component is mounted once in
 * `matters/[id]/layout.tsx`. Next.js layouts do not remount when
 * children (tabs) change, so form state survives tab navigation too.
 *
 * Close semantics:
 *   - × (or Esc in docked mode, or Cancel) → full close
 *   - Collapse icon (or Esc in expanded mode, or backdrop click) →
 *     back to docked, form state preserved
 */

"use client";

import Link from "next/link";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useTransition } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  findMatterCreateEntry,
  MATTER_CREATE_ENTRIES,
  type MatterCreateEntry,
} from "@/lib/matter-create-types";

/** Build a URL with updated create / expanded params. Passing `null`
 *  for a key removes it. */
function withPanelParams(
  pathname: string,
  current: URLSearchParams,
  changes: { create?: string | null; expanded?: string | null }
): string {
  const params = new URLSearchParams(current.toString());
  if ("create" in changes) {
    const v = changes.create;
    if (v === null) params.delete("create");
    else if (v !== undefined) params.set("create", v);
  }
  if ("expanded" in changes) {
    const v = changes.expanded;
    if (v === null) params.delete("expanded");
    else if (v !== undefined) params.set("expanded", v);
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function MatterCreatePanel({
  matterId,
  matterName,
  matterCaseNumber,
  matterColor,
}: {
  matterId: string;
  matterName: string;
  matterCaseNumber: string | null;
  matterColor: string;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isOnThisMatter = pathname.startsWith(`/matters/${matterId}`);
  const rawType = searchParams.get("create");
  const entry = rawType ? findMatterCreateEntry(rawType) : undefined;
  const expanded = searchParams.get("expanded") === "1";

  const close = useCallback(() => {
    startTransition(() => {
      router.replace(
        withPanelParams(pathname, searchParams, {
          create: null,
          expanded: null,
        }),
        { scroll: false }
      );
    });
  }, [pathname, router, searchParams]);

  const collapse = useCallback(() => {
    startTransition(() => {
      router.replace(
        withPanelParams(pathname, searchParams, { expanded: null }),
        { scroll: false }
      );
    });
  }, [pathname, router, searchParams]);

  const expand = useCallback(() => {
    startTransition(() => {
      router.replace(
        withPanelParams(pathname, searchParams, { expanded: "1" }),
        { scroll: false }
      );
    });
  }, [pathname, router, searchParams]);

  // ESC handler: in expanded mode, collapse back to docked; in docked,
  // full close. Only active while the panel is open.
  useEffect(() => {
    if (!entry) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (expanded) collapse();
        else close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [entry, expanded, collapse, close]);

  if (!isOnThisMatter || !entry) return null;

  return (
    <>
      {/* Backdrop only in expanded mode — separate from the aside so
          its mount/unmount doesn't affect the form state inside. */}
      {expanded && (
        <button
          type="button"
          aria-label="Collapse to sidebar"
          onClick={collapse}
          className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm cursor-default animate-in fade-in duration-100"
        />
      )}

      <aside
        aria-label={`Create ${entry.label}${expanded ? " (expanded)" : ""}`}
        className={cn(
          "bg-white flex flex-col min-h-0",
          // Shared chrome
          expanded
            ? // Modal mode: fixed-centered, out of flow
              "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(92vw,800px)] h-[min(85vh,720px)] rounded-xl shadow-2xl ring-1 ring-black/5 border border-line animate-in zoom-in-95 fade-in duration-100"
            : // Docked mode: in flex flow, reserves width
              "w-96 shrink-0 border-l border-line",
          pending && "opacity-95"
        )}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <div className="flex flex-col min-w-0">
            <span className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Create
            </span>
            <h2 className="text-sm font-display font-medium text-ink">
              {entry.label}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={expanded ? collapse : expand}
              aria-label={expanded ? "Collapse to sidebar" : "Expand to modal"}
              title={expanded ? "Collapse to sidebar" : "Expand to modal"}
              className="p-1 rounded-md text-ink-3 hover:bg-muted hover:text-ink-2"
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              title="Close"
              className="p-1 rounded-md text-ink-3 hover:bg-muted hover:text-ink-2"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* ── Matter context badge (expanded mode only) ──────────────
            In docked mode the TopBar above shows the matter name; in
            expanded mode the TopBar is hidden behind the backdrop so
            we surface the matter context here instead. */}
        {expanded && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-line shrink-0 bg-paper-2/40">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: matterColor }}
            />
            <span className="text-xs font-medium text-ink-2 truncate">
              {matterName}
            </span>
            {matterCaseNumber && (
              <span className="text-2xs font-mono text-ink-4 shrink-0">
                {matterCaseNumber}
              </span>
            )}
          </div>
        )}

        {/* ── Type switcher ───────────────────────────────────────── */}
        <div className="px-4 py-2 border-b border-line shrink-0">
          <div className="flex flex-wrap gap-1">
            {MATTER_CREATE_ENTRIES.map((e) => {
              const active = e.type === entry.type;
              return (
                <Link
                  key={e.type}
                  href={withPanelParams(pathname, searchParams, {
                    create: e.type,
                  })}
                  replace
                  scroll={false}
                  className={cn(
                    "text-2xs px-2 py-0.5 rounded-full border transition-colors",
                    active
                      ? "bg-brand-500 text-white border-brand-500"
                      : "bg-white text-ink-3 border-line hover:border-brand-300 hover:text-brand-700"
                  )}
                >
                  {e.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4">
          <PanelPlaceholderBody entry={entry} />
        </div>

        {/* ── Footer actions ──────────────────────────────────────── */}
        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line shrink-0 bg-paper-2/30">
          <button
            type="button"
            onClick={close}
            className="text-xs px-2.5 h-7 rounded-md border border-line bg-white text-ink-2 hover:border-brand-300 hover:text-brand-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled
            title="Form not implemented yet"
            className="text-xs px-2.5 h-7 rounded-md bg-brand-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </footer>
      </aside>
    </>
  );
}

/** Placeholder body — will be replaced per-type with real forms. */
function PanelPlaceholderBody({ entry }: { entry: MatterCreateEntry }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-3 leading-relaxed">{entry.description}</p>
      <div className="rounded-md border border-line bg-paper-2/30 p-3">
        <div className="text-2xs font-semibold uppercase tracking-wider text-ink-4 mb-2">
          Form fields
        </div>
        <ul className="flex flex-col gap-1.5 text-xs text-ink-2 list-disc pl-4">
          {entry.expected.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="text-2xs text-ink-4 leading-relaxed">
        The real form for this type is a Phase 2.X follow-up. The panel
        persists across matter-tab navigation and docked ↔ expanded
        transitions, so switching tabs or expanding to modal will keep
        your draft in place once the form is wired.
      </div>
    </div>
  );
}
