/**
 * Matter Detail Tab Bar
 *
 * Client component so it can read the active route segment via
 * `usePathname`. Hosted in the matter detail layout above the nested
 * tab content.
 *
 * There is deliberately no contextual "Add …" button here: the
 * matter Create stack has real form bodies only for notes, so a button
 * for deadlines / tasks / time / documents / events opened a placeholder
 * panel with a disabled Save. Each of those tabs has its own working
 * inline composer, which is the create surface. Bring the button back
 * once the stack has real bodies for those types (and gate it on the
 * matching create permission, resolved on the server).
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { slug: "", label: "Overview" },
  { slug: "timeline", label: "Timeline" },
  { slug: "events", label: "Events" },
  { slug: "communication", label: "Communication" },
  { slug: "documents", label: "Documents" },
  { slug: "evidence", label: "Evidence" },
  { slug: "parties", label: "Parties" },
  { slug: "deadlines", label: "Deadlines" },
  { slug: "tasks", label: "Tasks" },
  { slug: "notes", label: "Notes" },
  { slug: "time", label: "Time & expenses" },
  { slug: "billing", label: "Billing" },
] as const;

export function MatterTabs({ matterId }: { matterId: string }) {
  const pathname = usePathname();
  const base = `/matters/${matterId}`;

  // `undefined` when on a non-tab sub-route (e.g. /edit) so no tab
  // erroneously appears active. Falling back to "" would light up
  // Overview since its slug is "".
  const activeSlug = TABS.find((t) => {
    if (t.slug === "") return pathname === base;
    return pathname.startsWith(`${base}/${t.slug}`);
  })?.slug;

  return (
    <div className="flex items-center border-b border-line px-3 sm:px-5 gap-2">
      {/* Horizontal scroll on small screens — 12 tabs don't fit on
          a phone, so we let the user swipe through them. The active
          tab is anchored visually by its border-bottom. */}
      <nav className="flex gap-1 flex-1 overflow-x-auto scrollbar-thin -mb-px">
        {TABS.map((t) => {
          const href = t.slug ? `${base}/${t.slug}` : base;
          const active = t.slug === activeSlug;
          return (
            <Link
              key={t.slug || "overview"}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0",
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
    </div>
  );
}
