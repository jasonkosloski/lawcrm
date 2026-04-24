/**
 * Tab Add Button
 *
 * Small client-side button that opens the matter Create panel to a
 * specific type. Used at the top of each matter-detail tab (and
 * inside empty states) so users can add a new item from the relevant
 * context instead of reaching for the global Create dropdown.
 *
 * Mechanics: builds an href that adds `?create=<type>` to the current
 * URL (preserving any existing query params) and uses `Link` with
 * `replace` + `scroll={false}` so the panel opens without a
 * full-page transition.
 */

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Calendar,
  Clock,
  FileText,
  Plus,
  Receipt,
  StickyNote,
  CircleAlert,
  ListTodo,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  findMatterCreateEntry,
  type MatterCreateType,
} from "@/lib/matter-create-types";

const ICON_MAP: Record<string, LucideIcon> = {
  clock: Clock,
  note: StickyNote,
  task: ListTodo,
  deadline: CircleAlert,
  users: Users,
  document: FileText,
  calendar: Calendar,
  invoice: Receipt,
};

export function TabAddButton({
  type,
  variant = "default",
  className,
}: {
  type: MatterCreateType;
  /** "default" = filled primary button (for empty-state CTA).
   *  "subtle" = outline button (for top-of-tab placement). */
  variant?: "default" | "subtle";
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const entry = findMatterCreateEntry(type);
  if (!entry) return null;

  const params = new URLSearchParams(searchParams.toString());
  params.set("create", entry.type);
  const href = `${pathname}?${params.toString()}`;

  const Icon = ICON_MAP[entry.icon] ?? Plus;

  return (
    <Link
      href={href}
      replace
      scroll={false}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
        variant === "default"
          ? "bg-brand-500 text-white hover:bg-brand-600"
          : "bg-white text-ink-2 border border-line hover:border-brand-300 hover:text-brand-700",
        className
      )}
    >
      <Icon size={13} />
      {entry.label}
    </Link>
  );
}
