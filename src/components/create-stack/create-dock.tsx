/**
 * Create Dock
 *
 * Renders the open panels from the surrounding CreateStackProvider:
 *   - Focused panel: docked right-rail (or expanded modal)
 *   - Non-focused panels: compact chips inside the focused panel's
 *     chrome under an "Also open" label
 *
 * Generic — doesn't know whether it's inside a matter detail or the
 * calendar. The `context` on the provider drives the expanded-mode
 * context strip.
 */

"use client";

import { useEffect } from "react";
import {
  Calendar,
  Clock,
  FileText,
  Maximize2,
  Minimize2,
  Receipt,
  StickyNote,
  CircleAlert,
  ListTodo,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  findMatterCreateEntry,
  type MatterCreateEntry,
} from "@/lib/matter-create-types";
import { NotePanelBody } from "@/components/matters/notes/note-panel-body";
import { NewEventComposer } from "@/components/calendar/new-event-composer";
import { useCreateStack, type CreatePanel } from "./create-stack-provider";

const ICON_MAP: Record<MatterCreateEntry["icon"], LucideIcon> = {
  clock: Clock,
  note: StickyNote,
  task: ListTodo,
  deadline: CircleAlert,
  users: Users,
  document: FileText,
  calendar: Calendar,
  invoice: Receipt,
};

export function CreateDock() {
  const { panels, focusedId, context, close, focus, setExpanded } =
    useCreateStack();

  const focused = panels.find((p) => p.id === focusedId) ?? null;
  const minimized = panels.filter((p) => p.id !== focusedId);

  useEffect(() => {
    if (!focused) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (focused.expanded) setExpanded(focused.id, false);
      else close(focused.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focused, setExpanded, close]);

  if (panels.length === 0) return null;

  const showDocked = !!focused && !focused.expanded;
  const showExpanded = !!focused && focused.expanded;

  return (
    <>
      {showDocked && focused && (
        <aside
          aria-label={`Create panel (${findMatterCreateEntry(focused.type)?.label ?? focused.type})`}
          className="w-96 shrink-0 border-l border-line flex flex-col min-h-0 bg-white"
        >
          <PanelChrome
            panel={focused}
            minimized={minimized}
            matterId={context?.matterId ?? null}
            onClose={() => close(focused.id)}
            onExpand={() => setExpanded(focused.id, true)}
            onCollapse={() => setExpanded(focused.id, false)}
            onChipFocus={focus}
            onChipClose={close}
          />
        </aside>
      )}

      {showExpanded && focused && (
        <>
          <button
            type="button"
            aria-label="Collapse to sidebar"
            onClick={() => setExpanded(focused.id, false)}
            className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm cursor-default animate-in fade-in duration-100"
          />
          <aside
            aria-label={`Create panel (${findMatterCreateEntry(focused.type)?.label ?? focused.type}, expanded)`}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(92vw,800px)] h-[min(85vh,720px)] rounded-xl shadow-2xl ring-1 ring-black/5 border border-line bg-white flex flex-col min-h-0 animate-in zoom-in-95 fade-in duration-100"
          >
            <PanelChrome
              panel={focused}
              minimized={minimized}
              expanded
              contextBadge={context}
              matterId={context?.matterId ?? null}
              onClose={() => close(focused.id)}
              onExpand={() => setExpanded(focused.id, true)}
              onCollapse={() => setExpanded(focused.id, false)}
              onChipFocus={focus}
              onChipClose={close}
            />
          </aside>
        </>
      )}
    </>
  );
}

// ── Panel chrome (shared between docked + expanded) ──────────────────────

function PanelChrome({
  panel,
  minimized,
  expanded,
  contextBadge,
  matterId,
  onClose,
  onExpand,
  onCollapse,
  onChipFocus,
  onChipClose,
}: {
  panel: CreatePanel;
  minimized: CreatePanel[];
  expanded?: boolean;
  contextBadge?: {
    color: string;
    label: string;
    sublabel: string | null;
  } | null;
  matterId: string | null;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onChipFocus: (id: string) => void;
  onChipClose: (id: string) => void;
}) {
  const entry = findMatterCreateEntry(panel.type);
  if (!entry) return null;

  // Types with a real form render it inline and carry their own
  // footer (Save/Cancel). Everything else still falls through to the
  // placeholder body + disabled-save footer.
  const isNote = panel.type === "note" && matterId !== null;
  // Standalone event composer: the calendar page mounts the
  // create stack with no matter, so a "New event" panel there
  // creates a matter-less event (effectively personal). The
  // matter-detail page still routes through its own
  // EventComposer (with captures + team auto-add) since it has
  // matterId set.
  const isStandaloneEvent = panel.type === "event" && matterId === null;

  return (
    <>
      {/* Header */}
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
            onClick={expanded ? onCollapse : onExpand}
            aria-label={expanded ? "Collapse to sidebar" : "Expand to modal"}
            title={expanded ? "Collapse to sidebar" : "Expand to modal"}
            className="p-1 rounded-md text-ink-3 hover:bg-muted hover:text-ink-2"
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="p-1 rounded-md text-ink-3 hover:bg-muted hover:text-ink-2"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Context badge (expanded only, and only when provider passed context) */}
      {expanded && contextBadge && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-line shrink-0 bg-paper-2/40">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: contextBadge.color }}
          />
          <span className="text-xs font-medium text-ink-2 truncate">
            {contextBadge.label}
          </span>
          {contextBadge.sublabel && (
            <span className="text-2xs font-mono text-ink-4 shrink-0">
              {contextBadge.sublabel}
            </span>
          )}
        </div>
      )}

      {/* Minimized-panel chips */}
      {minimized.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b border-line shrink-0 bg-paper-2/30">
          <span className="text-2xs font-mono uppercase tracking-wider text-ink-4 mr-1">
            Also open
          </span>
          {minimized.map((m) => (
            <InlineChip
              key={m.id}
              panel={m}
              onFocus={() => onChipFocus(m.id)}
              onClose={() => onChipClose(m.id)}
            />
          ))}
        </div>
      )}

      {/* Body */}
      {isNote && matterId ? (
        <NotePanelBody panelId={panel.id} matterId={matterId} />
      ) : isStandaloneEvent ? (
        <div className="flex-1 overflow-y-auto p-4">
          <NewEventComposer panelId={panel.id} onClose={onClose} />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-3">
              <p className="text-xs text-ink-3 leading-relaxed">
                {entry.description}
              </p>
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
                The real form for this type is a follow-up. Open multiple
                panels at once if you need to capture several things in
                parallel — each one stays in the stack until you save or
                close it.
              </div>
            </div>
          </div>

          <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line shrink-0 bg-paper-2/30">
            <button
              type="button"
              onClick={onClose}
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
        </>
      )}
    </>
  );
}

// ── Inline chip for minimized panels ─────────────────────────────────────

function InlineChip({
  panel,
  onFocus,
  onClose,
}: {
  panel: CreatePanel;
  onFocus: () => void;
  onClose: () => void;
}) {
  const entry = findMatterCreateEntry(panel.type);
  if (!entry) return null;
  const Icon = ICON_MAP[entry.icon];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 h-6 pl-1.5 pr-0.5 rounded-full",
        "bg-white border border-line text-2xs text-ink-2",
        "hover:border-brand-300"
      )}
    >
      <button
        type="button"
        onClick={onFocus}
        className="inline-flex items-center gap-1 min-w-0 h-full hover:text-brand-700"
        title={`Switch to ${entry.label}`}
      >
        <Icon size={11} className="text-ink-3 shrink-0" />
        <span className="font-medium truncate max-w-24">{entry.label}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${entry.label}`}
        title="Close"
        className="p-0.5 rounded-full text-ink-4 hover:bg-muted hover:text-ink-2"
      >
        <X size={10} />
      </button>
    </div>
  );
}
