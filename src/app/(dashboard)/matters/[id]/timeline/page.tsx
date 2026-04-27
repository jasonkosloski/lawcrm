/**
 * Matter detail — Timeline tab.
 *
 * The unified chronological feed. Reads from `ActivityLog` (which
 * is populated by every action that creates a Note / Task /
 * Deadline / TimeEntry / CalendarEvent / Document / Invoice
 * transition / Stage transition / Team change / Permission
 * grant). The Timeline is the audit-trail surface for the matter.
 *
 * Filters via URL `?type=…` so links/back-button work. Pills:
 *   All · Filings · Communications · Deadlines · Tasks · Notes ·
 *   Time · Financial · System
 *
 * Each pill maps to one or more `ActivityLog.type` values — see
 * the FILTER_BUCKETS map below for the canonical groupings. The
 * counts come from `getMatterActivityTypeCounts(matterId)` so
 * empty buckets dim out and the user knows what's worth clicking.
 *
 * Render is intentionally low-chrome — date / icon / title /
 * source-chip / author. Long titles wrap; details (when present)
 * sit beneath in a muted line. Pin-to-overview, date scrubbing,
 * and PDF export are deferred follow-ups noted on MVP_TODO.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  formatDate,
  formatDayBucket,
  getCurrentUserTimeZone,
} from "@/lib/format-date";
import {
  Briefcase,
  Check,
  Circle,
  Clock,
  DollarSign,
  FileText,
  Gavel,
  Mail,
  StickyNote,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import {
  getMatterActivity,
  getMatterActivityTypeCounts,
} from "@/lib/queries/matter-detail";

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  gavel: Gavel,
  mail: Mail,
  video: Video,
  check: Check,
  zap: Zap,
  note: StickyNote,
  document: FileText,
  clock: Clock,
  dollar: DollarSign,
  briefcase: Briefcase,
};

/// Maps a filter pill key to the underlying ActivityLog.type values
/// it surfaces. Key "all" is the default and skips filtering. Keep
/// the union narrow per pill — overlapping buckets confuse the
/// matter-history mental model.
const FILTER_BUCKETS: Record<
  string,
  { label: string; types: readonly string[] }
> = {
  all: { label: "All", types: [] },
  filings: { label: "Filings", types: ["filing"] },
  communications: { label: "Communications", types: ["email"] },
  deadlines: { label: "Deadlines", types: ["deadline"] },
  tasks: { label: "Tasks", types: ["task", "task_complete"] },
  notes: { label: "Notes", types: ["note"] },
  time: { label: "Time", types: ["time_entry"] },
  financial: {
    label: "Financial",
    types: ["deposit", "settlement"],
  },
  events: { label: "Events", types: ["event"] },
};

const PILL_ORDER = [
  "all",
  "filings",
  "communications",
  "deadlines",
  "tasks",
  "notes",
  "time",
  "financial",
  "events",
] as const;

// Date rendering routes through the centralized formatter so
// every page interprets the user's timeZone uniformly.

export default async function MatterTimelinePage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/timeline">) {
  const { id } = await params;
  const sp = await searchParams;
  const rawType = Array.isArray(sp.type) ? sp.type[0] : sp.type;
  const filterKey =
    typeof rawType === "string" && rawType in FILTER_BUCKETS ? rawType : "all";
  const bucket = FILTER_BUCKETS[filterKey];

  const matter = await prisma.matter.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!matter) notFound();

  const [rows, counts, tz] = await Promise.all([
    getMatterActivity(id, {
      types: bucket.types.length > 0 ? bucket.types : undefined,
    }),
    getMatterActivityTypeCounts(id),
    getCurrentUserTimeZone(),
  ]);

  const totalCount = Object.values(counts).reduce((s, n) => s + n, 0);

  const countFor = (key: string): number => {
    if (key === "all") return totalCount;
    return FILTER_BUCKETS[key].types.reduce(
      (sum, t) => sum + (counts[t] ?? 0),
      0
    );
  };

  // Group rows by day so the timeline reads like a journal —
  // one date heading then the events under it. Headers reset on
  // each new local day.
  const groups = groupByDay(rows);

  return (
    <div className="p-5 max-w-3xl flex flex-col gap-4">
      {/* Filter pills. Each is a Link so the URL is the source of
          truth — back button works, deep linking works, no client
          state. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PILL_ORDER.map((key) => {
          const count = countFor(key);
          const active = key === filterKey;
          return (
            <Link
              key={key}
              href={
                key === "all"
                  ? `/matters/${id}/timeline`
                  : `/matters/${id}/timeline?type=${key}`
              }
              scroll={false}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-2xs font-medium border transition-colors",
                active
                  ? "bg-brand-500 text-white border-brand-500"
                  : count === 0
                    ? "bg-paper text-ink-4 border-line opacity-60 cursor-default pointer-events-none"
                    : "bg-white text-ink-2 border-line hover:border-brand-300 hover:text-brand-700"
              )}
            >
              {FILTER_BUCKETS[key].label}
              <span
                className={cn(
                  "font-mono text-2xs",
                  active ? "text-white/80" : "text-ink-4"
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Feed */}
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-ink-4">
            {filterKey === "all"
              ? "No activity recorded on this matter yet. Notes, tasks, deadlines, time entries, calendar events, document uploads, billing transitions, stage changes, and team adjustments will all show up here."
              : `No ${FILTER_BUCKETS[filterKey].label.toLowerCase()} activity yet on this matter.`}
          </CardContent>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <CardContent className="px-0 py-0">
            <ul className="flex flex-col">
              {groups.map(({ key, label, items }) => (
                <li key={key} className="border-b border-line last:border-b-0">
                  <div className="px-4 py-1.5 bg-paper-2/50 text-2xs font-mono uppercase tracking-wider text-ink-4 border-b border-line">
                    {label}
                  </div>
                  <ul className="flex flex-col">
                    {items.map((row) => {
                      const Icon = ACTIVITY_ICONS[row.iconName] ?? Circle;
                      return (
                        <li
                          key={row.id}
                          className="flex items-start gap-3 px-4 py-2.5 border-b border-line/60 last:border-b-0 hover:bg-paper-2/30"
                        >
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-paper-2 text-ink-3 shrink-0 mt-0.5">
                            <Icon size={12} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-ink leading-snug">
                              {row.title}
                            </div>
                            {row.detail && (
                              <div className="text-2xs text-ink-4 mt-0.5 leading-relaxed truncate">
                                {row.detail}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-1 text-2xs text-ink-4">
                              <span className="inline-block px-1.5 py-px rounded-full border border-line bg-white">
                                {row.source}
                              </span>
                              {row.authorName && (
                                <span>· {row.authorName}</span>
                              )}
                              <span className="font-mono">
                                · {formatDate(row.timestamp, "datetime", tz)}
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && rows.length === 200 && (
        <div className="text-2xs text-ink-4 text-center">
          Showing the most recent 200 events. Older entries land in
          the future archive view.
        </div>
      )}
    </div>
  );
}

/** Bucket rows into local-day groups for the journal-style header.
 *  "Today" / "Yesterday" labels for the first two; absolute date
 *  for everything older. Generic over the row shape so the
 *  caller's full ActivityRow type passes through unchanged. */
function groupByDay<T extends { id: string; timestamp: Date }>(
  rows: T[]
): Array<{
  key: string;
  label: string;
  items: T[];
}> {
  const now = new Date();

  const groups = new Map<string, { label: string; items: T[] }>();
  for (const row of rows) {
    const d = new Date(row.timestamp);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    if (!groups.has(key)) {
      // Centralized day-bucket labeling — same logic the firm
      // activity page and other journal-style views use.
      const label = formatDayBucket(d, { now });
      groups.set(key, { label, items: [] });
    }
    groups.get(key)!.items.push(row);
  }
  return Array.from(groups.entries()).map(([key, group]) => ({
    key,
    label: group.label,
    items: group.items,
  }));
}
