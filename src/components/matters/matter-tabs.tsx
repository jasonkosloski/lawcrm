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
 * to reach for the header Create dropdown. The button opens a new
 * panel in the matter Create stack — the current focused panel (if
 * any) minimizes to a chip.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  findMatterCreateEntry,
  type MatterCreateType,
} from "@/lib/matter-create-types";
import { useCreateStack } from "@/components/create-stack/create-stack-provider";

const TABS = [
  { slug: "", label: "Overview" },
  { slug: "timeline", label: "Timeline" },
  { slug: "events", label: "Events" },
  { slug: "communication", label: "Communication" },
  { slug: "documents", label: "Documents" },
  { slug: "parties", label: "Parties" },
  { slug: "deadlines", label: "Deadlines" },
  { slug: "tasks", label: "Tasks" },
  { slug: "notes", label: "Notes" },
  { slug: "time", label: "Time & expenses" },
  { slug: "billing", label: "Billing" },
] as const;

/** Map of tab slug → the create type to surface as a right-end button.
 *  Tabs not in this map have no contextual single-add action — the tab
 *  either has its own inline create surface (Notes uses a composer at
 *  the top of the tab) or there's no obvious single thing to create
 *  (Overview, Timeline, Billing). */
const TAB_ADD_TYPE: Record<string, MatterCreateType> = {
  events: "event",
  documents: "document",
  deadlines: "deadline",
  tasks: "task",
  time: "time",
};

export function MatterTabs({ matterId }: { matterId: string }) {
  const pathname = usePathname();
  const { open } = useCreateStack();
  const base = `/matters/${matterId}`;

  // `undefined` when on a non-tab sub-route (e.g. /edit) so no tab
  // erroneously appears active. Falling back to "" would light up
  // Overview since its slug is "".
  const activeSlug = TABS.find((t) => {
    if (t.slug === "") return pathname === base;
    return pathname.startsWith(`${base}/${t.slug}`);
  })?.slug;
  const addType = activeSlug ? TAB_ADD_TYPE[activeSlug] : undefined;
  const addEntry = addType ? findMatterCreateEntry(addType) : undefined;

  return (
    <div className="flex items-center border-b border-line px-5">
      <nav className="flex gap-1 flex-1">
        {TABS.map((t) => {
          const href = t.slug ? `${base}/${t.slug}` : base;
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
        <button
          type="button"
          onClick={() => open(addEntry.type)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium bg-white text-ink-2 border border-line hover:border-brand-300 hover:text-brand-700 transition-colors shrink-0"
        >
          <Plus size={13} />
          {addEntry.label}
        </button>
      )}
    </div>
  );
}
