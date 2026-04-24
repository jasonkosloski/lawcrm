/**
 * Intake Detail Tab Bar
 *
 * Client component so it can read the active route segment via
 * `usePathname`. Mirrors the matter-detail tab pattern: Overview is
 * the base route (`/intake/[id]`), other tabs are nested
 * (`/intake/[id]/communication`, etc.).
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { slug: "", label: "Overview" },
  { slug: "communication", label: "Communication" },
  { slug: "time", label: "Time & expenses" },
] as const;

export function IntakeTabs({ leadId }: { leadId: string }) {
  const pathname = usePathname();
  const base = `/intake/${leadId}`;

  return (
    <div className="flex items-center border-b border-line px-5">
      <nav className="flex gap-1 flex-1">
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
    </div>
  );
}
