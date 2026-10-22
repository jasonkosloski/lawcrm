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
 *
 * Keyboard: Escape / Tab are handled on the panel itself (not on
 * window), so only keystrokes made inside it count. Focus moves into
 * the panel when it opens, switches or expands; the expanded modal is
 * a real dialog (role, aria-modal, Tab trap). Docked, Escape closes a
 * panel only when nothing has been typed in it.
 */

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
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
import { findMatterCreateEntry, type MatterCreateEntry } from "@/lib/matter-create-types";
import { useCreateStack, type CreatePanel } from "./create-stack-provider";
import { Button } from "@/components/ui/button";

// The two real panel bodies pull in Tiptap/ProseMirror + server
// actions. The dock is mounted on every matter tab and the calendar but
// renders nothing until a panel opens, so load them on demand instead
// of shipping the editor stack in every page's initial JS.
const PanelLoading = () => (
  <div className="flex-1 p-4 text-xs text-ink-4" role="status">
    Loading…
  </div>
);
const NotePanelBody = dynamic(
  () => import("@/components/matters/notes/note-panel-body").then((m) => m.NotePanelBody),
  { loading: PanelLoading },
);
const NewEventComposer = dynamic(
  () => import("@/components/calendar/new-event-composer").then((m) => m.NewEventComposer),
  { loading: PanelLoading },
);

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

/** Matter tab (route slug + label) that already hosts a working inline
 *  form for each create type. Types with no real dock form send the
 *  user there instead of showing a dead form with a disabled Save. */
const TAB_FOR_TYPE: Record<MatterCreateEntry["type"], { slug: string; label: string }> = {
  time: { slug: "time", label: "Time & expenses" },
  note: { slug: "notes", label: "Notes" },
  task: { slug: "tasks", label: "Tasks" },
  deadline: { slug: "deadlines", label: "Deadlines" },
  party: { slug: "parties", label: "Parties" },
  document: { slug: "documents", label: "Documents" },
  event: { slug: "events", label: "Events" },
  invoice: { slug: "billing", label: "Billing" },
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** True when the panel body holds text the user typed — Escape must
 *  not throw that away. DOM-based on purpose: the dock is generic and
 *  each body owns its own form state. */
function bodyHasDraft(body: Element | null): boolean {
  if (!body) return false;
  const fields = body.querySelectorAll<HTMLElement>("textarea, input, [contenteditable='true']");
  for (const el of fields) {
    if (el instanceof HTMLInputElement) {
      if (["checkbox", "radio", "hidden", "button", "submit"].includes(el.type)) continue;
      if (el.value.trim()) return true;
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.value.trim()) return true;
    } else if (el.textContent?.trim()) {
      return true;
    }
  }
  return false;
}

export function CreateDock() {
  const { panels, focusedId, context, close, focus, setExpanded } = useCreateStack();

  const focused = panels.find((p) => p.id === focusedId) ?? null;
  const minimized = panels.filter((p) => p.id !== focusedId);
  const asideRef = useRef<HTMLElement>(null);

  // Move keyboard focus into the panel when one opens, switches or
  // expands (unless a body already autofocused something inside), so
  // Escape / Tab are relative to the panel and the expanded modal
  // isn't operated from behind its backdrop.
  const shownId = focused?.id ?? null;
  const shownExpanded = !!focused?.expanded;
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside || !shownId) return;
    if (!aside.contains(document.activeElement)) aside.focus();
  }, [shownId, shownExpanded]);

  // Keys are handled on the panel, not on window: a window listener
  // also saw Escapes meant for the notification dropdown, the nav
  // drawer or an IME composition, and closed the panel — discarding
  // the draft.
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!focused) return;

    if (e.key === "Tab" && focused.expanded) {
      // Trap focus inside the expanded modal.
      const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.closest(".hidden") === null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === e.currentTarget)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    if (e.key !== "Escape") return;
    // A popup inside the panel (select, popover) or an IME composition
    // already owns this Escape.
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (focused.expanded) {
      setExpanded(focused.id, false);
      return;
    }
    // Docked: close only a panel with nothing typed in it. A draft is
    // closed deliberately (the X), never by a stray Escape.
    const body = e.currentTarget.querySelector(`[data-panel-id="${focused.id}"]`);
    if (!bodyHasDraft(body)) close(focused.id);
  };

  if (panels.length === 0) return null;

  const expanded = !!focused?.expanded;
  const entryLabel = focused ? (findMatterCreateEntry(focused.type)?.label ?? focused.type) : "";

  // ONE shell for both modes. Docked and expanded used to be two
  // different JSX branches, so toggling expand unmounted the whole
  // subtree — and every draft in it. Now the backdrop is a sibling in
  // a fixed slot (`false` still occupies the slot) and the <aside>
  // keeps its position/type; only its className and aria-label change.
  return (
    <>
      {expanded && focused ? (
        <button
          type="button"
          aria-label="Collapse to sidebar"
          // Out of the tab order: the panel's own collapse button is
          // the keyboard path, and the trap must stay inside the panel.
          tabIndex={-1}
          onClick={() => setExpanded(focused.id, false)}
          className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm cursor-default animate-in fade-in duration-100"
        />
      ) : null}
      {focused && (
        <aside
          ref={asideRef}
          key="create-panel-shell"
          tabIndex={-1}
          // Dialog semantics only in the expanded modal; the docked
          // rail stays a complementary landmark. Same element either
          // way, so toggling never remounts the drafts inside.
          role={expanded ? "dialog" : undefined}
          aria-modal={expanded ? true : undefined}
          aria-label={`Create panel (${entryLabel}${expanded ? ", expanded" : ""})`}
          onKeyDown={onPanelKeyDown}
          className={
            expanded
              ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(92vw,800px)] h-[min(85vh,720px)] rounded-xl shadow-2xl ring-1 ring-black/5 border border-line bg-white flex flex-col min-h-0 outline-none animate-in zoom-in-95 fade-in duration-100"
              : // Below sm the 384px rail would overflow <main> and
                // clip the close/Save controls, so it becomes a
                // full-screen overlay there.
                "w-full sm:w-96 sm:shrink-0 max-sm:fixed max-sm:inset-0 max-sm:z-40 border-l border-line flex flex-col min-h-0 bg-white outline-none"
          }
        >
          <PanelChrome
            panel={focused}
            minimized={minimized}
            expanded={expanded}
            contextBadge={expanded ? context : null}
            onClose={() => close(focused.id)}
            onExpand={() => setExpanded(focused.id, true)}
            onCollapse={() => setExpanded(focused.id, false)}
            onChipFocus={focus}
            onChipClose={close}
          >
            {/* Every open panel's body stays mounted (keyed by panel
                id) so its draft survives expand/collapse and focus
                switches, and no two panels ever share one form
                instance. Only the focused body is visible. */}
            {panels.map((p) => (
              <PanelBody
                key={p.id}
                panel={p}
                visible={p.id === focused.id}
                matterId={context?.matterId ?? null}
                close={close}
              />
            ))}
          </PanelChrome>
        </aside>
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
  onClose,
  onExpand,
  onCollapse,
  onChipFocus,
  onChipClose,
  children,
}: {
  panel: CreatePanel;
  minimized: CreatePanel[];
  expanded?: boolean;
  contextBadge?: {
    color: string;
    label: string;
    sublabel: string | null;
  } | null;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onChipFocus: (id: string) => void;
  onChipClose: (id: string) => void;
  children: ReactNode;
}) {
  const entry = findMatterCreateEntry(panel.type);
  if (!entry) return null;

  return (
    <>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-2xs font-medium text-ink-3">Create</span>
          <h2 className="text-sm font-display font-medium text-ink">{entry.label}</h2>
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
          <span className="text-xs font-medium text-ink-2 truncate">{contextBadge.label}</span>
          {contextBadge.sublabel && (
            <span className="text-2xs font-mono text-ink-4 shrink-0">{contextBadge.sublabel}</span>
          )}
        </div>
      )}

      {/* Minimized-panel chips */}
      {minimized.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b border-line shrink-0 bg-paper-2/30">
          <span className="text-2xs font-medium text-ink-3 mr-1">Also open</span>
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

      {/* Bodies (one per open panel; only the focused one is visible) */}
      {children}
    </>
  );
}

// ── Panel body (one mounted instance per open panel) ─────────────────────

function PanelBody({
  panel,
  visible,
  matterId,
  close,
}: {
  panel: CreatePanel;
  visible: boolean;
  matterId: string | null;
  close: (id: string) => void;
}) {
  // `close` changes identity whenever the stack changes. Bodies fire
  // their onClose from effects keyed on it (NewEventComposer closes on
  // status "ok"), so hand them a per-panel callback that is stable for
  // the panel's lifetime — otherwise a finished panel re-fires close
  // on every stack change.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  const panelId = panel.id;
  const onClose = useCallback(() => closeRef.current(panelId), [panelId]);

  const entry = findMatterCreateEntry(panel.type);
  if (!entry) return null;

  // Types with a real form render it inline and carry their own
  // footer (Save/Cancel). Everything else points at the matter tab
  // that hosts the working form (no dead Save button).
  const isNote = panel.type === "note" && matterId !== null;
  // Standalone event composer: the calendar page mounts the
  // create stack with no matter, so a "New event" panel there
  // creates a matter-less event (effectively personal). The
  // matter-detail page still routes through its own
  // EventComposer (with captures + team auto-add) since it has
  // matterId set.
  const isStandaloneEvent = panel.type === "event" && matterId === null;
  const tab = TAB_FOR_TYPE[entry.type];

  return (
    <div data-panel-id={panel.id} className={visible ? "flex flex-1 min-h-0 flex-col" : "hidden"}>
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
              <p className="text-xs text-ink-3 leading-relaxed">{entry.description}</p>
              <p className="text-xs text-ink-2 leading-relaxed">
                {matterId
                  ? `There is no quick form for this yet — the ${tab.label} tab has the full form.`
                  : `There is no quick form for this yet — open a matter and use its ${tab.label} tab.`}
              </p>
            </div>
          </div>

          <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line shrink-0 bg-paper-2/30">
            <Button variant="outline" size="xs" type="button" onClick={onClose}>
              Cancel
            </Button>
            {matterId && (
              <Button
                size="xs"
                render={<Link href={`/matters/${matterId}/${tab.slug}`} onClick={onClose} />}
              >
                Go to {tab.label}
              </Button>
            )}
          </footer>
        </>
      )}
    </div>
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
        "hover:border-brand-300",
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
