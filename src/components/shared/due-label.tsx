/**
 * DueLabel: how a due date reads everywhere (UI system v2, ADR-056).
 * The date plus a countdown, coloured only when it matters:
 * overdue is danger, due within two days is warn, the rest is grey.
 *
 *   "Oct 25 · 5d"   "Today"   "Tomorrow"   "Oct 18 · 2d late"
 *
 * `dueDate` is a date-only value (UTC midnight, ADR-012) and `days` is
 * the server-computed countdown against the viewer's today, so this
 * renders the same on the server and in the browser.
 */

import { cn } from "@/lib/utils";
import { formatDateOnly } from "@/lib/format-date";

export function dueTone(days: number): "danger" | "warn" | "muted" {
  if (days < 0) return "danger";
  if (days <= 2) return "warn";
  return "muted";
}

export function dueText(days: number): string {
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days}d`;
}

const TONE = {
  danger: "text-danger font-medium",
  warn: "text-warn font-medium",
  muted: "text-ink-4",
} as const;

export function DueLabel({
  dueDate,
  days,
  className,
}: {
  dueDate?: Date | null;
  days: number;
  className?: string;
}) {
  const tone = dueTone(days);
  // Today and Tomorrow say the date already; elsewhere lead with it.
  const showDate = dueDate && days !== 0 && days !== 1;
  return (
    <span
      className={cn(
        "whitespace-nowrap text-2xs tabular-nums",
        TONE[tone],
        className
      )}
    >
      {showDate && (
        <span className={tone === "muted" ? "text-ink-3" : undefined}>
          {formatDateOnly(dueDate, "short")}
          {" · "}
        </span>
      )}
      {dueText(days)}
    </span>
  );
}
