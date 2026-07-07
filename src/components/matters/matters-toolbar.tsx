/**
 * Matters Toolbar
 *
 * Search + filter popovers + status toggles above the matters table.
 * URL query params are the source of truth; this component reads them
 * via `useSearchParams` and writes them back with `router.replace`.
 * Server re-renders the filtered table on every URL change.
 *
 * Each filter is a popover (Linear-style). When a filter has an active
 * value, the trigger button shows a blue chip with the count. Outside
 * clicks close popovers; changes apply immediately — no Apply button.
 */

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, plural } from "@/lib/utils";
import {
  FEE_LABELS,
  type DeadlineFilter,
  type MattersFilter,
  type TrustFilter,
  type ViewMode,
} from "@/lib/matters-filters";
import { MattersViewToggle } from "@/components/matters/matters-view-toggle";

const SEARCH_DEBOUNCE_MS = 250;

type Lead = { id: string; name: string; initials: string };
type FilterOptions = {
  areas: string[];
  stages: string[];
  feeStructures: string[];
  leads: Lead[];
};

export function MattersToolbar({
  filter,
  options,
  view,
  visibleCount,
  totalCount,
}: {
  filter: MattersFilter;
  options: FilterOptions;
  view: ViewMode;
  visibleCount: number;
  totalCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParams = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    mutate(next);
    startTransition(() => {
      router.replace(`?${next.toString()}`, { scroll: false });
    });
  };

  const toggleInList = (key: string, value: string) => {
    setParams((p) => {
      const current = p.getAll(key);
      if (current.includes(value)) {
        p.delete(key);
        for (const v of current) if (v !== value) p.append(key, v);
      } else {
        p.append(key, value);
      }
    });
  };

  const setSingle = (key: string, value: string | null) => {
    setParams((p) => {
      if (value === null) p.delete(key);
      else p.set(key, value);
    });
  };

  const toggleFlag = (key: string, on: boolean) => {
    setParams((p) => {
      if (on) p.set(key, "1");
      else p.delete(key);
    });
  };

  const clearAll = () => {
    setParams((p) => {
      for (const k of [
        "q",
        "area",
        "stage",
        "lead",
        "fee",
        "trust",
        "deadline",
        "archived",
        "pinned",
        "show_closed",
      ]) {
        p.delete(k);
      }
    });
  };

  // ── Debounced text search ────────────────────────────────────────────
  const [qLocal, setQLocal] = useState(filter.q);
  const latestQ = useRef(filter.q);
  useEffect(() => {
    // Keep local state in sync with URL changes from elsewhere (clear-all, etc).
    if (filter.q !== latestQ.current) {
      setQLocal(filter.q);
      latestQ.current = filter.q;
    }
  }, [filter.q]);
  useEffect(() => {
    if (qLocal === latestQ.current) return;
    const handle = setTimeout(() => {
      latestQ.current = qLocal;
      setParams((p) => {
        if (qLocal) p.set("q", qLocal);
        else p.delete("q");
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);

  const statusFlagCount =
    (filter.includeArchived ? 1 : 0) + (filter.pinnedOnly ? 1 : 0);

  const anyActive =
    filter.q.length > 0 ||
    filter.areas.length > 0 ||
    filter.stages.length > 0 ||
    filter.leadIds.length > 0 ||
    filter.feeStructures.length > 0 ||
    filter.trust !== "any" ||
    filter.deadline !== "any" ||
    statusFlagCount > 0;

  return (
    <div className={cn("flex flex-col gap-3", pending && "opacity-95")}>
      {/* ── Row 1: search + result count + clear ──────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4"
          />
          <Input
            value={qLocal}
            onChange={(e) => setQLocal(e.target.value)}
            placeholder="Search by matter name or case number…"
            className="pl-8 h-8 text-xs"
          />
          {qLocal && (
            <button
              type="button"
              onClick={() => setQLocal("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <span className="text-xs text-ink-3">
          {visibleCount === totalCount
            ? plural(totalCount, "matter")
            : `${visibleCount} of ${plural(totalCount, "matter")}`}
        </span>
        {anyActive && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-brand-700 hover:underline"
          >
            Clear all
          </button>
        )}
        <div className="ml-auto">
          <MattersViewToggle view={view} />
        </div>
      </div>

      {/* ── Row 2: filter popovers ────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <MultiSelectFilter
          label="Area"
          options={options.areas}
          selected={filter.areas}
          onToggle={(v) => toggleInList("area", v)}
          onClear={() => setParams((p) => p.delete("area"))}
        />
        <MultiSelectFilter
          label="Stage"
          options={options.stages}
          selected={filter.stages}
          onToggle={(v) => toggleInList("stage", v)}
          onClear={() => setParams((p) => p.delete("stage"))}
        />
        <MultiSelectFilter
          label="Lead"
          options={options.leads.map((l) => ({
            value: l.id,
            label: l.name,
            hint: l.initials,
          }))}
          selected={filter.leadIds}
          onToggle={(v) => toggleInList("lead", v)}
          onClear={() => setParams((p) => p.delete("lead"))}
        />
        <MultiSelectFilter
          label="Fee"
          options={options.feeStructures.map((f) => ({
            value: f,
            label: FEE_LABELS[f] ?? f,
          }))}
          selected={filter.feeStructures}
          onToggle={(v) => toggleInList("fee", v)}
          onClear={() => setParams((p) => p.delete("fee"))}
        />
        <SingleSelectFilter<TrustFilter>
          label="Trust"
          active={filter.trust !== "any"}
          activeLabel={TRUST_LABELS[filter.trust]}
          options={[
            { value: "any", label: "Any" },
            { value: "has", label: "Has trust (> $0)" },
            { value: "none", label: "No trust ($0)" },
            { value: "over-10k", label: "Over $10,000" },
          ]}
          selected={filter.trust}
          onSelect={(v) => setSingle("trust", v === "any" ? null : v)}
        />
        <SingleSelectFilter<DeadlineFilter>
          label="Deadline"
          active={filter.deadline !== "any"}
          activeLabel={DEADLINE_LABELS[filter.deadline]}
          options={[
            { value: "any", label: "Any" },
            { value: "overdue", label: "Overdue" },
            { value: "within-7d", label: "Within 7 days" },
            { value: "within-30d", label: "Within 30 days" },
            { value: "none", label: "No open deadlines" },
          ]}
          selected={filter.deadline}
          onSelect={(v) => setSingle("deadline", v === "any" ? null : v)}
        />

        {/* Status flags — single popover with three toggles. */}
        <Popover>
          <PopoverTrigger
            render={
              <FilterButton
                label="Status"
                activeCount={statusFlagCount}
                active={statusFlagCount > 0}
              />
            }
          />
          <PopoverContent align="start" className="w-56">
            <FlagRow
              label="Pinned only"
              checked={filter.pinnedOnly}
              onToggle={(on) => toggleFlag("pinned", on)}
            />
            <FlagRow
              label="Include archived"
              checked={filter.includeArchived}
              onToggle={(on) => toggleFlag("archived", on)}
            />
          </PopoverContent>
        </Popover>

        {/* Show-closed toggle. Closed/Settled matters are hidden by
            default so the list stays focused on open work. Toggle to
            include terminal stages — useful for reporting and for
            looking up old matters.
            TODO (auth): hide this toggle for users whose role the firm
            has not authorized to view closed files. */}
        <ShowClosedToggle
          checked={filter.showClosed}
          onToggle={(on) => toggleFlag("show_closed", on)}
        />
      </div>
    </div>
  );
}

function ShowClosedToggle({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onToggle(!checked)}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border transition-colors",
        checked
          ? "bg-brand-soft text-brand-700 border-brand-200 hover:border-brand-300"
          : "bg-white text-ink-2 border-line hover:border-brand-300 hover:text-brand-700"
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border shrink-0 transition-colors",
          checked
            ? "bg-brand-500 border-brand-500"
            : "bg-white border-line"
        )}
      >
        {checked && <Check size={10} className="text-white" strokeWidth={3} />}
      </span>
      Show closed
    </button>
  );
}

// ── Shared trigger button ───────────────────────────────────────────────

function FilterButton({
  label,
  activeCount,
  active,
  ...props
}: {
  label: string;
  activeCount?: number;
  active?: boolean;
} & React.ComponentProps<"button">) {
  return (
    <Button
      variant="outline"
      size="xs"
      className={cn(
        "font-normal",
        active && "bg-brand-soft text-brand-700 border-brand-200 hover:bg-brand-50"
      )}
      {...props}
    >
      {label}
      {typeof activeCount === "number" && activeCount > 0 && (
        <span className="ml-1 font-mono font-medium">· {activeCount}</span>
      )}
    </Button>
  );
}

// ── Multi-select popover (checkboxes) ───────────────────────────────────

type MultiOption = string | { value: string; label: string; hint?: string };

function MultiSelectFilter({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const normalized = options.map((o) =>
    typeof o === "string" ? { value: o, label: o, hint: undefined } : o
  );
  const activeLabel =
    selected.length === 1
      ? (normalized.find((o) => o.value === selected[0])?.label ?? selected[0])
      : undefined;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <FilterButton
            label={
              activeLabel
                ? `${label}: ${truncate(activeLabel, 18)}`
                : label
            }
            activeCount={selected.length > 1 ? selected.length : undefined}
            active={selected.length > 0}
          />
        }
      />
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-line">
          <span className="text-xs font-medium text-ink-2">{label}</span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-2xs text-brand-700 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {normalized.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-ink-4">No options</li>
          )}
          {normalized.map((o) => {
            const on = selected.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => onToggle(o.value)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-muted/60"
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-4 h-4 rounded border shrink-0",
                      on
                        ? "bg-brand-500 border-brand-500 text-white"
                        : "border-line"
                    )}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="text-2xs font-mono text-ink-4">
                      {o.hint}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ── Single-select popover (radio-like) ──────────────────────────────────

function SingleSelectFilter<T extends string>({
  label,
  options,
  selected,
  active,
  activeLabel,
  onSelect,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  active: boolean;
  activeLabel: string;
  onSelect: (value: T) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <FilterButton
            label={active ? `${label}: ${activeLabel}` : label}
            active={active}
          />
        }
      />
      <PopoverContent align="start" className="w-56 p-0">
        <ul className="py-1">
          {options.map((o) => {
            const on = selected === o.value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => onSelect(o.value)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-muted/60"
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border shrink-0",
                      on ? "border-brand-500" : "border-line"
                    )}
                  >
                    {on && (
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                    )}
                  </span>
                  <span className="flex-1">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ── Flag toggle row used inside the Status popover ──────────────────────

function FlagRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!checked)}
      className="w-full flex items-center gap-2 px-1.5 py-1.5 text-xs text-left rounded hover:bg-muted/60"
    >
      <span
        className={cn(
          "inline-flex items-center justify-center w-4 h-4 rounded border shrink-0",
          checked ? "bg-brand-500 border-brand-500 text-white" : "border-line"
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

const TRUST_LABELS: Record<TrustFilter, string> = {
  any: "Any",
  has: "Has trust",
  none: "No trust",
  "over-10k": "Over $10k",
};

const DEADLINE_LABELS: Record<DeadlineFilter, string> = {
  any: "Any",
  overdue: "Overdue",
  "within-7d": "Within 7 days",
  "within-30d": "Within 30 days",
  none: "None open",
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
