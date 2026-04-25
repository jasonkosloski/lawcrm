/**
 * File To Matter Picker
 *
 * Replaces the read-only "Unfiled" / matter pill in the email thread
 * reader header with a clickable popover. Two states:
 *
 *   - Unfiled → "File to matter…" pill with a warn-amber tint.
 *     Click opens the popover with a search input + matter list.
 *   - Filed → existing matter pill with a small chevron, click opens
 *     the same popover (now showing the current matter as active +
 *     an "Unfile" option).
 *
 * Pinned matters bubble to the top of the list. Server-side search
 * isn't needed today — open-matter sets are small enough to filter
 * client-side.
 */

"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Briefcase, Check, Pin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { setEmailThreadMatter } from "@/app/actions/email-filing";
import type { FilingMatterOption } from "@/lib/queries/communication";

export function FileToMatterPicker({
  threadId,
  currentMatter,
  options,
}: {
  threadId: string;
  currentMatter: { id: string; name: string; color: string; area: string } | null;
  options: FilingMatterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.area.toLowerCase().includes(q)
    );
  }, [query, options]);

  const file = (matterId: string | null) => {
    setOpen(false);
    setQuery("");
    startTransition(async () => {
      const res = await setEmailThreadMatter(threadId, matterId);
      if (!res.ok && res.error) alert(res.error);
    });
  };

  const trigger = currentMatter ? (
    // Filed — existing matter pill is still a Link to the matter
    // (preserves the original behavior) but we wrap it in a click
    // target that opens the picker via a separate icon button.
    <span className="inline-flex items-center gap-1.5 text-2xs">
      <Link
        href={`/matters/${currentMatter.id}`}
        className="inline-flex items-center gap-1.5 font-mono text-ink-3 hover:text-brand-700"
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: currentMatter.color }}
        />
        {currentMatter.name} · {currentMatter.area}
      </Link>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={pending}
            title="Change matter"
            aria-label="Change matter"
            className="inline-flex items-center justify-center w-5 h-5 rounded-md text-ink-4 hover:text-brand-700 hover:bg-paper-2"
          >
            <Briefcase size={11} />
          </button>
        }
      />
    </span>
  ) : (
    <PopoverTrigger
      render={
        <button
          type="button"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1 h-6 px-2 text-2xs font-medium rounded-md border transition-colors",
            "bg-warn-soft text-warn border-warn-border",
            "hover:border-warn",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <Briefcase size={11} />
          File to matter…
        </button>
      }
    />
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverContent align="start" className="w-72">
        <div className="flex flex-col gap-2">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-3">
            File to matter
          </div>
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
            />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search matters…"
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

          <ul className="flex flex-col gap-px max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="text-2xs text-ink-4 italic px-2 py-1.5">
                No matters match.
              </li>
            ) : (
              filtered.map((m) => {
                const active = currentMatter?.id === m.id;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => file(m.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-left",
                        active
                          ? "bg-brand-soft text-brand-700"
                          : "text-ink hover:bg-paper-2"
                      )}
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
              })
            )}
          </ul>

          {currentMatter && (
            <div className="border-t border-line pt-2">
              <button
                type="button"
                onClick={() => file(null)}
                className="w-full inline-flex items-center gap-1.5 px-2 py-1 text-2xs text-warn hover:bg-warn-soft rounded-md"
              >
                <X size={11} />
                Unfile (move back to inbox)
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
