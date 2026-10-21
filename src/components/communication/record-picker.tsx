/**
 * Record Picker
 *
 * Pure selection of a matter or an intake lead: a search input over a
 * list grouped "Matters" / "Leads". No server calls - the host decides
 * what a pick means (the thread reader files the thread, compose and
 * the reply composer record the scope to post). Same client-side
 * filter idiom the file-to-matter picker used: the option sets are
 * small enough to filter in the browser. Pinned matters bubble to the
 * top (the query already orders them).
 */

"use client";

import { useMemo, useState } from "react";
import { Check, Pin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecordScope } from "@/lib/record-scope";
import type {
  FilingLeadOption,
  FilingMatterOption,
} from "@/lib/queries/communication";

export function RecordPicker({
  matters,
  leads,
  value,
  onChange,
  disabled = false,
  placeholder = "Search matters and leads…",
}: {
  matters: FilingMatterOption[];
  leads: FilingLeadOption[];
  value: RecordScope | null;
  onChange: (scope: RecordScope | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filteredMatters = useMemo(
    () =>
      q
        ? matters.filter(
            (m) =>
              m.name.toLowerCase().includes(q) ||
              m.area.toLowerCase().includes(q),
          )
        : matters,
    [q, matters],
  );
  const filteredLeads = useMemo(
    () =>
      q
        ? leads.filter(
            (l) =>
              l.name.toLowerCase().includes(q) ||
              l.stage.toLowerCase().includes(q),
          )
        : leads,
    [q, leads],
  );

  const rowClass = (active: boolean) =>
    cn(
      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-left",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      active ? "bg-brand-soft text-brand-700" : "text-ink hover:bg-paper-2",
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
        />
        <input
          type="text"
          autoFocus
          disabled={disabled}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full pl-7 pr-7 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
        {filteredMatters.length === 0 && filteredLeads.length === 0 && (
          <p className="text-2xs text-ink-4 italic px-2 py-1.5">
            No matters or leads match.
          </p>
        )}

        {filteredMatters.length > 0 && (
          <section aria-label="Matters">
            <h3 className="px-2 pb-1 text-2xs font-medium text-ink-4">
              Matters
            </h3>
            <ul className="flex flex-col gap-px">
              {filteredMatters.map((m) => {
                const active =
                  value?.kind === "matter" && value.matterId === m.id;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        onChange({ kind: "matter", matterId: m.id })
                      }
                      className={rowClass(active)}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: m.color }}
                      />
                      <span className="flex-1 truncate">{m.name}</span>
                      {m.isPinned && (
                        <Pin
                          size={10}
                          className="text-ink-4 shrink-0"
                          aria-label="Pinned"
                        />
                      )}
                      <span className="text-2xs font-mono text-ink-4 shrink-0">
                        {m.area}
                      </span>
                      {active && (
                        <Check size={11} className="text-brand-700 shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {filteredLeads.length > 0 && (
          <section aria-label="Leads">
            <h3 className="px-2 pb-1 text-2xs font-medium text-ink-4">
              Leads
            </h3>
            <ul className="flex flex-col gap-px">
              {filteredLeads.map((l) => {
                const active = value?.kind === "lead" && value.leadId === l.id;
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange({ kind: "lead", leadId: l.id })}
                      className={rowClass(active)}
                    >
                      <span className="flex-1 truncate">{l.name}</span>
                      <span className="text-2xs font-mono text-ink-4 shrink-0">
                        {l.stage}
                      </span>
                      {active && (
                        <Check size={11} className="text-brand-700 shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
