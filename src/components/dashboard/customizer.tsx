/**
 * Dashboard customizer - view mode + in-place edit mode.
 *
 * View mode renders the saved layout: a full-width band, then a 12-col
 * grid whose columns follow the split (stacked below lg). Edit mode
 * swaps in a toolbar (split picker, hidden tray, reset, cancel, done)
 * and an editor: dnd-kit drag-and-drop across the band and columns at
 * lg+, and a button/select list editor below lg (touch-friendly and
 * the path jsdom tests drive). All edits are local until Done, which
 * saves the whole layout once.
 *
 * `cards` holds only cards that render something for this viewer. A
 * placed card missing from `cards` renders nothing in view mode; in
 * edit mode it shows its label and a muted reason (`unavailable` =
 * hidden from this role; otherwise it is simply not loaded yet because
 * it was hidden when the page rendered).
 */

"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  EyeOff,
  GripVertical,
  RotateCcw,
  Settings2,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { saveDashboardLayout } from "@/app/actions/dashboard-prefs";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DASHBOARD_CARDS,
  DEFAULT_LAYOUT,
  SPLIT_SPANS,
  layoutsEqual,
  mergeLayout,
  moveCard,
  setSplit,
  type DashboardCardKey,
  type DashboardLayout,
  type SplitSpan,
} from "@/lib/dashboard-prefs";
import { SplitPicker } from "./split-picker";

// Literal class strings so Tailwind generates them; typed against the
// span values so an unexpected span is a compile error.
const SPAN_CLASS: Record<SplitSpan, string> = {
  4: "lg:col-span-4",
  6: "lg:col-span-6",
  8: "lg:col-span-8",
  12: "lg:col-span-12",
};

type Zone = "band" | number;

const zoneName = (z: Zone) => (z === "band" ? "Band" : `Column ${z + 1}`);
const zoneId = (z: Zone) => `zone:${z}`;
const label = (k: DashboardCardKey) => DASHBOARD_CARDS[k].label;

const zoneList = (l: DashboardLayout, z: Zone) =>
  z === "band" ? l.band : l.columns[z];

const zonesOf = (l: DashboardLayout): Zone[] => [
  "band",
  ...l.columns.map((_, i) => i),
];

function zoneOfCard(l: DashboardLayout, key: DashboardCardKey): Zone | null {
  return zonesOf(l).find((z) => zoneList(l, z).includes(key)) ?? null;
}

/**
 * Pure drop handler: move `activeKey` to `over` (zone + index in that
 * list after the card is removed, which for same-list reorders is
 * dnd-kit's own `arrayMove` index). `null` (dropped outside) = no change.
 */
export function applyDragEnd(
  layout: DashboardLayout,
  activeKey: DashboardCardKey,
  over: { zone: Zone; index: number } | null
): DashboardLayout {
  if (!over) return layout;
  return moveCard(
    layout,
    activeKey,
    over.zone === "band"
      ? { zone: "band" }
      : { zone: "column", index: over.zone },
    over.index
  );
}

/** Resolve a dnd-kit `over.id` (zone container or card) to a drop spot. */
function resolveOver(
  layout: DashboardLayout,
  overId: string
): { zone: Zone; index: number } | null {
  if (overId.startsWith("zone:")) {
    const raw = overId.slice(5);
    const zone: Zone = raw === "band" ? "band" : Number(raw);
    if (zone !== "band" && !layout.columns[zone]) return null;
    return { zone, index: zoneList(layout, zone).length };
  }
  const key = overId as DashboardCardKey;
  const zone = zoneOfCard(layout, key);
  if (zone === null) return null;
  return { zone, index: zoneList(layout, zone).indexOf(key) };
}

const present = (cards: Props["cards"], k: DashboardCardKey) =>
  cards[k] !== undefined && cards[k] !== null && cards[k] !== false;

type Props = {
  initialLayout: DashboardLayout;
  cards: Partial<Record<DashboardCardKey, ReactNode>>;
  /** Cards this viewer may not see (drives the edit-mode note). */
  unavailable?: DashboardCardKey[];
  /** Greeting line; the Customize trigger sits beside it. */
  greeting?: ReactNode;
};

export function DashboardCustomizer({
  initialLayout,
  cards,
  unavailable = [],
  greeting,
}: Props) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [committed, setCommitted] = useState(initialLayout);
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeKey, setActiveKey] = useState<DashboardCardKey | null>(null);

  const cancel = () => {
    setLayout(committed);
    setEditing(false);
  };

  // Esc cancels the session - but not while a drag is active (dnd-kit
  // uses Esc to cancel the drag itself; it also preventDefaults it).
  useEffect(() => {
    if (!editing || saving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (rootRef.current?.getAttribute("data-dragging") === "true") return;
      setLayout(committed);
      setEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, saving, committed]);

  const done = async () => {
    if (layoutsEqual(layout, committed)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await saveDashboardLayout(layout);
      setCommitted(layout);
      router.refresh();
      setEditing(false);
    } catch {
      toast.error("Couldn't save your dashboard layout");
    } finally {
      setSaving(false);
    }
  };

  const spans = SPLIT_SPANS[layout.split];
  const shown = (keys: DashboardCardKey[]) =>
    keys.filter((k) => present(cards, k));

  return (
    <div
      ref={rootRef}
      data-customizer
      data-dragging={activeKey ? "true" : undefined}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">{greeting}</div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-2 bg-white px-2.5 text-xs text-ink-3 transition-colors hover:border-brand-300"
          >
            <Settings2 size={13} />
            <span>Customize</span>
          </button>
        )}
      </div>

      {editing ? (
        <>
          <Toolbar
            layout={layout}
            saving={saving}
            onSplit={(s) => setLayout((l) => setSplit(l, s))}
            onRestore={(k) =>
              setLayout((l) => moveCard(l, k, { zone: "column", index: 0 }))
            }
            onReset={() => setLayout(mergeLayout(DEFAULT_LAYOUT))}
            onCancel={cancel}
            onDone={done}
          />
          <DragEditor
            layout={layout}
            setLayout={setLayout}
            cards={cards}
            unavailable={unavailable}
            activeKey={activeKey}
            setActiveKey={setActiveKey}
          />
          <ListEditor
            layout={layout}
            setLayout={setLayout}
            cards={cards}
            unavailable={unavailable}
          />
        </>
      ) : (
        <>
          {shown(layout.band).length > 0 && (
            <div data-band className="mb-5 flex flex-col gap-5">
              {shown(layout.band).map((k) => (
                <div key={k}>{cards[k]}</div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-12 gap-5">
            {spans.map((span, i) => {
              const keys = shown(layout.columns[i] ?? []);
              // Keep an empty column's grid slot (lg+ only) so the
              // others don't slide to the left edge.
              if (keys.length === 0)
                return (
                  <div
                    key={i}
                    data-column={i}
                    aria-hidden
                    className={`hidden ${SPAN_CLASS[span]} lg:block`}
                  />
                );
              return (
                <div
                  key={i}
                  data-column={i}
                  className={`col-span-12 flex min-w-0 flex-col gap-5 ${SPAN_CLASS[span]}`}
                >
                  {keys.map((k) => (
                    <div key={k}>{cards[k]}</div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Toolbar({
  layout,
  saving,
  onSplit,
  onRestore,
  onReset,
  onCancel,
  onDone,
}: {
  layout: DashboardLayout;
  saving: boolean;
  onSplit: (s: DashboardLayout["split"]) => void;
  onRestore: (k: DashboardCardKey) => void;
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const btn =
    "h-7 rounded-md border border-line-2 bg-white px-2.5 text-xs text-ink-3 transition-colors hover:border-brand-300 disabled:opacity-50";
  return (
    <div
      role="toolbar"
      aria-label="Customize dashboard"
      className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-paper px-3 py-2 shadow-sm"
    >
      <SplitPicker value={layout.split} onChange={onSplit} />
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-3">
          Hidden ({layout.hidden.length})
        </span>
        {layout.hidden.map((k) => (
          <button
            key={k}
            type="button"
            aria-label={`Restore ${label(k)}`}
            onClick={() => onRestore(k)}
            className="rounded-full border border-line-2 bg-paper-2 px-2 py-0.5 text-2xs text-ink-3 hover:border-brand-300"
          >
            {label(k)}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <button type="button" className={btn} onClick={onReset}>
          <RotateCcw size={12} className="mr-1 inline" aria-hidden />
          Reset to default
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="h-7 rounded-md bg-ink px-3 text-xs text-white disabled:opacity-50"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** Edit-mode body for a card: the dimmed live card, or a note. */
function EditBody({
  k,
  cards,
  unavailable,
}: {
  k: DashboardCardKey;
  cards: Props["cards"];
  unavailable: DashboardCardKey[];
}) {
  if (present(cards, k)) {
    return (
      <div inert className="max-h-48 overflow-hidden opacity-60">
        {cards[k]}
      </div>
    );
  }
  return (
    <p className="px-3 py-3 text-xs text-ink-4">
      {unavailable.includes(k)
        ? "Not available for your role"
        : "Shown after you save"}
    </p>
  );
}

// ── Drag editor (lg+) ─────────────────────────────────────────────────

function DragEditor({
  layout,
  setLayout,
  cards,
  unavailable,
  activeKey,
  setActiveKey,
}: {
  layout: DashboardLayout;
  setLayout: (fn: (l: DashboardLayout) => DashboardLayout) => void;
  cards: Props["cards"];
  unavailable: DashboardCardKey[];
  activeKey: DashboardCardKey | null;
  setActiveKey: (k: DashboardCardKey | null) => void;
}) {
  const sensors = useSensors(
    // Small distance so the strip's Hide button stays clickable.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const where = (overId: string | number | undefined) => {
    const r = overId === undefined ? null : resolveOver(layout, String(overId));
    return r ? zoneName(r.zone) : "its original place";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${label(active.id as DashboardCardKey)}.`,
    onDragOver: ({ active, over }) =>
      `${label(active.id as DashboardCardKey)} is over ${where(over?.id)}.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${label(active.id as DashboardCardKey)} was dropped in ${where(over.id)}.`
        : `${label(active.id as DashboardCardKey)} was dropped outside; no change.`,
    onDragCancel: ({ active }) =>
      `Move cancelled. ${label(active.id as DashboardCardKey)} returned to ${where(active.id)}.`,
  };

  const onDragStart = (e: DragStartEvent) =>
    setActiveKey(e.active.id as DashboardCardKey);
  const onDragEnd = (e: DragEndEvent) => {
    setActiveKey(null);
    const key = e.active.id as DashboardCardKey;
    setLayout((l) => {
      const over = e.over ? resolveOver(l, String(e.over.id)) : null;
      return applyDragEnd(l, key, over);
    });
  };

  const spans = SPLIT_SPANS[layout.split];
  const zoneProps = {
    cards,
    unavailable,
    onHide: (k: DashboardCardKey) =>
      setLayout((l) => moveCard(l, k, { zone: "hidden" })),
  };

  return (
    <div className="hidden lg:block">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{ announcements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveKey(null)}
      >
        <DropZone zone="band" keys={layout.band} {...zoneProps} />
        <div className="mt-5 grid grid-cols-12 gap-5">
          {spans.map((span, i) => (
            <div key={i} className={`col-span-12 min-w-0 ${SPAN_CLASS[span]}`}>
              <DropZone zone={i} keys={layout.columns[i] ?? []} {...zoneProps} />
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeKey ? (
            <div className="rounded-lg border border-brand-300 bg-card px-3 py-2 text-sm text-ink shadow-lg">
              {label(activeKey)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function DropZone({
  zone,
  keys,
  cards,
  unavailable,
  onHide,
}: {
  zone: Zone;
  keys: DashboardCardKey[];
  cards: Props["cards"];
  unavailable: DashboardCardKey[];
  onHide: (k: DashboardCardKey) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: zoneId(zone) });
  return (
    <div
      ref={setNodeRef}
      data-zone={zone}
      className={`flex min-h-24 flex-col gap-3 rounded-xl border border-dashed p-2 ${
        isOver ? "border-brand-300 bg-paper-2" : "border-line-2"
      }`}
    >
      <div className="px-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">
        {zoneName(zone)}
      </div>
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        {keys.map((k) => (
          <SortableCard
            key={k}
            k={k}
            cards={cards}
            unavailable={unavailable}
            onHide={onHide}
          />
        ))}
      </SortableContext>
      {keys.length === 0 && (
        <p className="px-1 py-4 text-center text-xs text-ink-4">
          Drop a card here
        </p>
      )}
    </div>
  );
}

function SortableCard({
  k,
  cards,
  unavailable,
  onHide,
}: {
  k: DashboardCardKey;
  cards: Props["cards"];
  unavailable: DashboardCardKey[];
  onHide: (k: DashboardCardKey) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: k });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl border border-line bg-card ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-2 border-b border-line px-2 py-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Drag ${label(k)}`}
          className="cursor-grab touch-none rounded p-0.5 text-ink-4 hover:text-ink"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
          {label(k)}
        </span>
        <button
          type="button"
          aria-label={`Hide ${label(k)}`}
          onClick={() => onHide(k)}
          className="rounded p-0.5 text-ink-4 hover:text-ink"
        >
          <EyeOff size={14} />
        </button>
      </div>
      <EditBody k={k} cards={cards} unavailable={unavailable} />
    </div>
  );
}

// ── List editor (below lg) ────────────────────────────────────────────

function ListEditor({
  layout,
  setLayout,
  cards,
  unavailable,
}: {
  layout: DashboardLayout;
  setLayout: (fn: (l: DashboardLayout) => DashboardLayout) => void;
  cards: Props["cards"];
  unavailable: DashboardCardKey[];
}) {
  const move = (k: DashboardCardKey, zone: Zone, position?: number) =>
    setLayout((l) =>
      applyDragEnd(l, k, { zone, index: position ?? zoneList(l, zone).length })
    );
  const iconBtn =
    "flex size-7 items-center justify-center rounded text-ink-3 hover:bg-paper-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30";

  return (
    <div
      role="region"
      aria-label="Arrange cards"
      className="flex flex-col gap-4 lg:hidden"
    >
      {zonesOf(layout).map((zone) => {
        const keys = zoneList(layout, zone);
        return (
          <div
            key={String(zone)}
            role="group"
            aria-label={zoneName(zone)}
            className="flex flex-col gap-2 rounded-xl border border-dashed border-line-2 p-2"
          >
            <div className="px-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">
              {zoneName(zone)}
            </div>
            {keys.length === 0 && (
              <p className="px-1 py-2 text-xs text-ink-4">No cards</p>
            )}
            <ul className="flex flex-col gap-2">
              {keys.map((k, i) => (
                <li
                  key={k}
                  data-card={k}
                  className="rounded-lg border border-line bg-card px-2 py-1.5"
                >
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                      {label(k)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Move ${label(k)} up`}
                      disabled={i === 0}
                      onClick={() => move(k, zone, i - 1)}
                      className={iconBtn}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${label(k)} down`}
                      disabled={i === keys.length - 1}
                      onClick={() => move(k, zone, i + 1)}
                      className={iconBtn}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Hide ${label(k)}`}
                      onClick={() =>
                        setLayout((l) => moveCard(l, k, { zone: "hidden" }))
                      }
                      className={iconBtn}
                    >
                      <EyeOff size={14} />
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <label
                      htmlFor={`zone-${k}`}
                      className="sr-only"
                    >{`Zone for ${label(k)}`}</label>
                    <NativeSelect
                      id={`zone-${k}`}
                      size="sm"
                      value={String(zone)}
                      onChange={(e) => {
                        const v = e.target.value;
                        move(k, v === "band" ? "band" : Number(v));
                      }}
                    >
                      {zonesOf(layout).map((z) => (
                        <option key={String(z)} value={String(z)}>
                          {zoneName(z)}
                        </option>
                      ))}
                    </NativeSelect>
                    {!present(cards, k) && (
                      <span className="text-2xs text-ink-4">
                        {unavailable.includes(k)
                          ? "Not available for your role"
                          : "Shown after you save"}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
