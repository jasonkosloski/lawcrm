/**
 * Settings — Firm activity log.
 *
 * Cross-matter audit view. Same shape as the per-matter Timeline
 * tab but with two extra filters:
 *   - User dropdown: scope to one author
 *   - Date range: from / to bounds
 *
 * Filter pills on type bucket are also URL-driven so deep-links +
 * back-button work without any client state.
 *
 * Page is gated on `firm.view_activity`. The settings sidebar
 * hides the link for users without it.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDate } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  FIRM_ACTIVITY_LIMIT,
  getFirmActivity,
  listFirmActivityAuthors,
} from "@/lib/queries/firm-activity";
import { requireUser } from "@/lib/current-user";
import {
  ACTIVITY_FILTER_BUCKETS as FILTER_BUCKETS,
  ACTIVITY_PILL_ORDER as PILL_ORDER,
} from "@/lib/constants/activity-filters";
import { activityIcon } from "@/lib/activity-icons";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { firstParam } from "@/lib/search-params";

// Date rendering routes through the centralized formatter.

export default async function FirmActivityPage({
  searchParams,
}: PageProps<"/settings/activity">) {
  await requireUser();
  // Page-level gate. Settings sidebar hides this link for users
  // without the permission, but a deep-link still bounces here.
  const ok = await currentUserHasPermission("firm.view_activity");
  if (!ok) redirect("/");

  const sp = await searchParams;

  const rawType = firstParam(sp.type);
  const filterKey =
    typeof rawType === "string" && Object.hasOwn(FILTER_BUCKETS, rawType)
      ? rawType
      : "all";

  const rawUser = firstParam(sp.user);
  const userId =
    typeof rawUser === "string" && rawUser.length > 0 ? rawUser : undefined;

  const rawFrom = firstParam(sp.from);
  const from = typeof rawFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawFrom) ? rawFrom : undefined;

  const rawTo = firstParam(sp.to);
  const to = typeof rawTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawTo) ? rawTo : undefined;

  const bucket = FILTER_BUCKETS[filterKey];

  // Day filters cut on the VIEWER's calendar days (rows display in
  // this zone), so resolve it before querying.
  const tz = await getCurrentUserTimeZone();
  const [rows, authors] = await Promise.all([
    getFirmActivity({
      types: bucket.types.length > 0 ? bucket.types : undefined,
      userId,
      from,
      to,
      tz,
    }),
    listFirmActivityAuthors(),
  ]);

  /** Build a query-string preserving the other filters when one
   *  changes. Pass null to clear a single key. */
  const buildHref = (overrides: Record<string, string | null>): string => {
    const params = new URLSearchParams();
    if (filterKey !== "all") params.set("type", filterKey);
    if (userId) params.set("user", userId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/settings/activity?${qs}` : "/settings/activity";
  };

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div>
        <h1 className="text-base font-semibold text-ink">Firm activity</h1>
        <p className="text-xs text-ink-3 mt-1">
          Cross-matter audit log. Every action that creates a Note /
          Task / Deadline / TimeEntry / Event / Document /
          Invoice transition / Stage change / Team change /
          Permission grant writes a row here.
        </p>
      </div>

      {/* Type pills — same look as the matter Timeline. Each is
          a Link so back-button + deep-link work. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PILL_ORDER.map((key) => {
          const active = key === filterKey;
          return (
            <Link
              key={key}
              href={buildHref({ type: key === "all" ? null : key })}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-2xs font-medium border transition-colors",
                active
                  ? "bg-paper-2 text-ink border-line-strong font-medium"
                  : "bg-white text-ink-2 border-line hover:border-brand-300 hover:text-brand-700"
              )}
            >
              {FILTER_BUCKETS[key].label}
            </Link>
          );
        })}
      </div>

      {/* User + date filters. Plain GET form so the URL is the
          source of truth (matches the pills' behavior). */}
      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 px-3 py-2 rounded-md border border-line bg-paper"
      >
        {filterKey !== "all" && (
          <input type="hidden" name="type" value={filterKey} />
        )}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="activity-user"
            className="text-xs font-medium text-ink-2"
          >
            User
          </label>
          <NativeSelect
            id="activity-user"
            name="user"
            defaultValue={userId ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">Anyone</NativeSelectOption>
            {authors.map((u) => (
              <NativeSelectOption key={u.id} value={u.id}>
                {u.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="activity-from"
            className="text-xs font-medium text-ink-2"
          >
            From
          </label>
          <input
            id="activity-from"
            type="date"
            name="from"
            defaultValue={from ?? ""}
            className={inputClass()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="activity-to"
            className="text-xs font-medium text-ink-2"
          >
            To
          </label>
          <input
            id="activity-to"
            type="date"
            name="to"
            defaultValue={to ?? ""}
            className={inputClass()}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            type="submit"
          >
            Apply
          </Button>
          {(userId || from || to) && (
            <Link
              href={buildHref({ user: null, from: null, to: null })}
              className="h-8 px-2 rounded-md text-xs text-ink-3 hover:text-ink"
            >
              Reset
            </Link>
          )}
        </div>
      </form>

      {/* Feed */}
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-ink-4">
            No activity matches these filters.
          </CardContent>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <CardContent className="px-0 py-0">
            <ul className="flex flex-col">
              {rows.map((row) => {
                const Icon = activityIcon(row.iconName);
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
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1 text-2xs text-ink-4">
                        <span className="inline-block px-1.5 py-px rounded-full border border-line bg-white">
                          {row.source}
                        </span>
                        {row.matterId && row.matterName && (
                          <Link
                            href={`/matters/${row.matterId}`}
                            className="text-brand-700 hover:underline"
                          >
                            · {row.matterName}
                          </Link>
                        )}
                        {row.authorName && <span>· {row.authorName}</span>}
                        <span className="font-mono">
                          · {formatDate(row.timestamp, "datetime", tz)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {rows.length === FIRM_ACTIVITY_LIMIT && (
        <div className="text-2xs text-ink-4 text-center">
          Showing the most recent {FIRM_ACTIVITY_LIMIT} events. Narrow the filters to
          surface older entries.
        </div>
      )}
    </div>
  );
}
