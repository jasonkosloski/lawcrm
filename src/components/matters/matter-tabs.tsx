/**
 * Matter Detail Tab Bar
 *
 * Client component so it can read the active route segment via
 * `usePathname`. Hosted in the matter detail layout above the nested
 * tab content.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

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

export function MatterTabs({ matterId }: { matterId: string }) {
  const pathname = usePathname();
  const base = `/matters/${matterId}`;

  return (
    <nav className="flex gap-1 border-b border-line px-5">
      {TABS.map((t) => {
        const href = t.slug ? `${base}/${t.slug}` : base;
        const active = t.slug
          ? pathname.startsWith(`${base}/${t.slug}`)
          : pathname === base;
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
  );
}
