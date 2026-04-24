/**
 * Tab Add Button
 *
 * Empty-state CTA that opens a new Create panel in the matter stack
 * for a specific type. Used inside each matter-detail tab's empty
 * state so users can add their first item without hunting for the
 * header Create dropdown.
 *
 * Opens via the provider's `open()` which minimizes the current
 * focused panel (if any) and makes the new one focused.
 */

"use client";

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
import { useMatterCreateStack } from "./matter-create-stack-provider";

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
  const { open } = useMatterCreateStack();
  const entry = findMatterCreateEntry(type);
  if (!entry) return null;
  const Icon = ICON_MAP[entry.icon] ?? Plus;

  return (
    <button
      type="button"
      onClick={() => open(entry.type)}
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
    </button>
  );
}
