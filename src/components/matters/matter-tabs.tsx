/**
 * Matter Detail Tab Bar
 *
 * Client component so it can read the active route segment via
 * `usePathname`. Hosted in the matter detail layout above the nested
 * tab content.
 *
 * The right end of the tab bar renders a contextual "Add …" button
 * for tabs where there's an obvious single thing to create (Add
 * party on Parties, Add deadline on Deadlines, etc.). This balances
 * the visual weight of the bar and gives users a CTA without having
 * to reach for the header Create dropdown.
 *
 * Query params on the current URL are preserved on tab navigation so
 * side-panels controlled by `?create=<type>` survive tab clicks.
 */

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  findMatterCreateEntry,
  type MatterCreateType,
} from "@/lib/matter-create-types";

const TABS = [
  { slug: "", label: "Overview" },
  { slug: "timeline", label: "Timeline" },
  { slug: "documents", label: "Documents" },
  { slug: "parties", label: "Parties" },
  { slug: "deadlines", label: "Deadlines" },
  { slug: "tasks", label: "Tasks" },
  { slug: "notes", label: "Notes" },
  { slug: "billing", label: "Billing" },
] as const;

/** Map of tab slug → the create type to surface as a right-end button.
 *  Tabs not in this map (Overview, Timeline, Billing) have no contextual
 *  single-add action, so no button renders for them. */
const TAB_ADD_TYPE: Record<string, MatterCreateType> = {
  documents: "document",
  parties: "party",
  deadlines: "deadline",
  tasks: "task",
  notes: "note",
};

export function MatterTabs({ matterId }: { matterId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/matters/${matterId}`;
  // Preserve the current query string on tab navigation so side-panels
  // controlled by URL params (e.g. `?create=note`) survive tab clicks.
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : "";

  // Which tab is currently active? Maps to an add-button type if any.
  const activeSlug =
    TABS.find((t) => {
      if (t.slug === "") return pathname === base;
      return pathname.startsWith(`${base}/${t.slug}`);
    })?.slug ?? "";
  const addType = TAB_ADD_TYPE[activeSlug];
  const addEntry = addType ? findMatterCreateEntry(addType) : undefined;

  const buildCreateHref = (type: MatterCreateType): string => {
    const params = new URLSearchParams(qs);
    params.set("create", type);
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="flex items-center border-b border-line px-5">
      <nav className="flex gap-1 flex-1">
        {TABS.map((t) => {
          const href = (t.slug ? `${base}/${t.slug}` : base) + suffix;
          const active = t.slug === activeSlug;
          return (
            <Link
              key={t.slug || "overview"}
              href={href}
              className={cn(
                "px-3 py-2.5 text-xs font-medium -mb-px border-b-2 transition-colors",
                active
                  ? "text-brand-700 border-brand-500"
                  : "text-ink-3 border-transparent hover:text-ink hover:border-line"
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {addEntry && (
        <Link
          href={buildCreateHref(addEntry.type)}
          replace
          scroll={false}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium bg-white text-ink-2 border border-line hover:border-brand-300 hover:text-brand-700 transition-colors shrink-0"
        >
          <Plus size={13} />
          {addEntry.label}
        </Link>
      )}
    </div>
  );
}
