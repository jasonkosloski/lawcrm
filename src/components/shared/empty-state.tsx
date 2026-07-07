import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared empty-state treatment — icon, title, optional description,
 * optional CTA slot. Matches the polish of the best hand-rolled
 * empty states (template library, notifications feed) so every list
 * stops inventing its own.
 *
 * Server-safe (no hooks); works inside client components too.
 *
 * Wrapping is the caller's job — drop it inside a Card, a table
 * shell, or a scroll pane. Set `framed` for the standalone
 * dashed-border card look (search results, full-page empties).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  framed = false,
  className,
}: {
  /** Lucide icon rendered muted above the title. */
  icon?: LucideIcon;
  title: string;
  /** One or two sentences of guidance — what lands here, or what to
   *  do to fill it. Strings or inline JSX (links) both work. */
  description?: React.ReactNode;
  /** CTA slot — a button or link rendered under the description. */
  children?: React.ReactNode;
  /** Standalone dashed-border card treatment for empties that don't
   *  already sit inside a Card / bordered shell. */
  framed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-4 py-8 text-center",
        framed && "rounded-lg border border-dashed border-line-2 bg-card",
        className
      )}
    >
      {Icon && <Icon size={18} className="text-ink-4" aria-hidden="true" />}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {description && (
        <div className="text-xs text-ink-3 max-w-sm">{description}</div>
      )}
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}
