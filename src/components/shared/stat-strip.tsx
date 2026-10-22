/**
 * StatStrip: a row of headline figures in one bordered card, split by
 * hairlines (UI system v2, ADR-057). Label above value, no icons, no
 * tints: colour is kept for figures that need attention (`tone`).
 *
 * Columns follow the item count (2 / 3 / 4) so there is never an orphan
 * cell; below `sm` the strip becomes a two-column grid, and an odd last
 * cell spans the row.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

export type Stat = {
  label: string;
  value: string;
  /** One short grey line under the value: its baseline or scope. */
  detail?: string;
  /** Colour the value only when it needs attention. */
  tone?: "default" | "ok" | "warn" | "danger" | "muted";
  href?: string;
};

const COLS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
};

const TONE: Record<NonNullable<Stat["tone"]>, string> = {
  default: "text-ink",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  muted: "text-ink-4",
};

export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  if (stats.length === 0) return null;
  return (
    <dl
      className={cn(
        "grid grid-cols-2 rounded-lg border border-line bg-card overflow-hidden",
        COLS[Math.min(stats.length, 5)],
        className,
      )}
    >
      {stats.map((stat, i) => {
        const body = (
          <>
            <dt className="text-2xs font-medium text-ink-3">{stat.label}</dt>
            <dd
              className={cn(
                "mt-1 text-2xl leading-8 font-medium tracking-tight tabular-nums",
                TONE[stat.tone ?? "default"],
              )}
            >
              {stat.value}
            </dd>
            {stat.detail && <dd className="mt-0.5 text-2xs text-ink-4 truncate">{stat.detail}</dd>}
          </>
        );
        const cell = cn(
          "min-w-0 px-5 py-4 border-line",
          // Hairlines: every cell but the first in a row gets a left
          // rule; on the phone's two-column grid, rows after the first
          // get a top rule and an odd last cell spans the row.
          i % 2 === 1 && "border-l",
          i >= 2 && "border-t sm:border-t-0",
          i > 0 && "sm:border-l",
          stats.length % 2 === 1 && i === stats.length - 1 && "col-span-2 sm:col-span-1",
        );
        return stat.href ? (
          <Link
            key={stat.label}
            href={stat.href}
            className={cn(cell, "block hover:bg-paper/60 transition-colors")}
          >
            {body}
          </Link>
        ) : (
          <div key={stat.label} className={cell}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}
