/**
 * Statute of Limitations card — prominent on the matter Overview
 * when the practice area has hasStatuteOfLimitations=true.
 *
 * Shows the deadline, days remaining, and a manual satisfied toggle
 * (the button the user flips when the complaint has been filed /
 * notice served / etc). Color coding escalates as the deadline
 * approaches:
 *   - Satisfied → ok/muted
 *   - > 60 days → neutral
 *   - 31–60    → caution
 *   - 0–30     → warn
 *   - past due → urgent (warn + emphasis)
 *
 * TODO (automation): auto-flip satisfied when a matching filing
 * document is linked + verified. For now it's manual.
 */

"use client";

import { useOptimistic, useTransition } from "react";
import { CheckCircle2, Circle, Loader2, TriangleAlert } from "lucide-react";
import { cn, plural } from "@/lib/utils";
import {
  dateOnlyKey,
  daysUntilDateOnly,
  formatDate,
  formatDateOnly,
} from "@/lib/format-date";
import { computeSolDate, type SolPeriod } from "@/lib/sol";
import { notifyError } from "@/lib/feedback";
import { useUserTimeZone } from "@/components/user-time-zone";
import { Card, CardContent } from "@/components/ui/card";
import { setMatterSolSatisfied } from "@/app/actions/matters";

export type StatuteOfLimitationsCardProps = {
  matterId: string;
  date: Date | null;
  satisfied: boolean;
  satisfiedAt: Date | null;
  notes: string | null;
  /** Citation for the firm-configured SOL period on this matter's
   *  practice area. When non-null we render a small "per [cite]"
   *  hint so the lawyer can verify the auto-computation against
   *  the actual statute. */
  citation?: string | null;
  /** When the SOL date was auto-computed from incident + period
   *  rather than explicitly entered, surface the source so the
   *  attorney sees how the date was derived. Cosmetic — the
   *  field doesn't change the underlying data. */
  incidentDate?: Date | null;
  /** The practice area's statute period (amount + unit, ADR-035). When provided,
   *  the "from incident" provenance is shown only if the date really
   *  is incident + period; otherwise the date is a manual override and
   *  the line says so instead of implying it was derived. */
  statutePeriod?: SolPeriod | null;
  /** Server-resolved `matters.edit` (the key `setMatterSolSatisfied`
   *  enforces). Without it the toggle isn't rendered — the heading
   *  already reads "Satisfied" / the countdown either way. */
  canEdit: boolean;
};

/** For date-only values stored as UTC midnight (SOL deadline,
 *  incident date): format on the UTC day grid, or users west of UTC
 *  see the previous day - a factually wrong deadline (ADR-012). */
export function formatCalendarDate(d: Date): string {
  return formatDateOnly(d, "full_short");
}

export function StatuteOfLimitationsCard({
  matterId,
  date,
  satisfied,
  satisfiedAt,
  notes,
  citation,
  incidentDate,
  statutePeriod,
  canEdit,
}: StatuteOfLimitationsCardProps) {
  const [optimisticSatisfied, setOptimisticSatisfied] =
    useOptimistic(satisfied);
  const [pending, startTransition] = useTransition();
  // "Today" is the viewer's calendar day in their PROFILE zone - the
  // same zone the server render uses - so SSR and hydration agree
  // instead of the server (UTC) and browser disagreeing each evening.
  const tz = useUserTimeZone();

  const toggle = () => {
    startTransition(async () => {
      setOptimisticSatisfied(!optimisticSatisfied);
      const res = await setMatterSolSatisfied(matterId, !optimisticSatisfied);
      if (!res.ok && res.error) notifyError(res.error);
    });
  };

  // Only claim "from incident" when the date matches incident + period
  // (needs the period; without it we can't tell, so keep the old copy).
  const computedFromIncident = computeSolDate(
    incidentDate,
    statutePeriod
  );
  const isManualDate =
    !!date &&
    !!computedFromIncident &&
    dateOnlyKey(computedFromIncident) !== dateOnlyKey(date);

  // No date set yet — gentle prompt instead of countdown chrome.
  if (!date) {
    return (
      <Card className="border-warn-border bg-warn-soft/20">
        <CardContent className="px-4 py-3 flex items-center gap-3">
          <TriangleAlert size={16} className="text-warn shrink-0" />
          <div className="flex-1 min-w-0 text-xs text-ink-2">
            <div className="font-medium text-ink">
              No statute-of-limitations date set
            </div>
            <div className="text-2xs text-ink-3">
              This practice area tracks SOL — add the deadline via
              Matter → Edit.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const days = daysUntilDateOnly(date, tz);
  const past = days < 0;

  // Tone: satisfied dominates; otherwise escalate by days.
  const tone: "ok" | "neutral" | "caution" | "warn" | "urgent" =
    optimisticSatisfied
      ? "ok"
      : past
        ? "urgent"
        : days <= 30
          ? "warn"
          : days <= 60
            ? "caution"
            : "neutral";

  const toneClasses = {
    ok: "border-line bg-ok-soft/30",
    neutral: "border-line bg-paper-2/40",
    caution: "border-brand-200 bg-brand-soft/40",
    warn: "border-warn-border bg-warn-soft/40",
    urgent: "border-warn-border bg-warn-soft",
  }[tone];

  const labelText = optimisticSatisfied
    ? "Satisfied"
    : past
      ? `${plural(Math.abs(days), "day")} overdue`
      : days === 0
        ? "Due today"
        : `${plural(days, "day")} remaining`;

  const labelTone = {
    ok: "text-ok",
    neutral: "text-ink-2",
    caution: "text-brand-700",
    warn: "text-warn",
    urgent: "text-warn font-semibold",
  }[tone];

  return (
    <Card className={cn("transition-colors", toneClasses)}>
      <CardContent className="px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Statute of limitations
          </div>
          {pending && (
            <span className="inline-flex items-center gap-1 text-2xs text-ink-4">
              <Loader2 size={10} className="animate-spin" />
              updating…
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className={cn("text-sm font-semibold", labelTone)}>
              {labelText}
            </div>
            <div className="text-2xs text-ink-3 font-mono">
              {formatCalendarDate(date)}
            </div>
          </div>

          {canEdit ? (
            <button
              type="button"
              onClick={toggle}
              disabled={pending}
              aria-pressed={optimisticSatisfied}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border transition-colors shrink-0",
                optimisticSatisfied
                  ? "bg-ok-soft text-ok border-line hover:border-ok"
                  : "bg-white text-ink-2 border-line hover:border-brand-300 hover:text-brand-700",
                pending && "opacity-60 cursor-wait"
              )}
            >
              {optimisticSatisfied ? (
                <CheckCircle2 size={13} className="text-ok" />
              ) : (
                <Circle size={13} />
              )}
              {optimisticSatisfied ? "Satisfied" : "Mark satisfied"}
            </button>
          ) : null}
        </div>

        {optimisticSatisfied && satisfiedAt && (
          <div className="text-2xs text-ink-4">
            Marked satisfied {formatDate(satisfiedAt, "full_short", tz)}
          </div>
        )}

        {/* Provenance line: when both an incident date and a
            citation are available the line reads as the full
            audit ("per CRS… from incident MM/DD/YYYY"); either
            alone surfaces independently so the lawyer always
            sees the strongest signal we have. */}
        {(citation || incidentDate) && (
          <div className="text-2xs text-ink-4 flex flex-wrap items-center gap-x-1.5">
            {incidentDate && isManualDate && (
              <span>
                manual date (incident{" "}
                <span className="font-mono">
                  {formatCalendarDate(incidentDate)}
                </span>{" "}
                + period would give{" "}
                <span className="font-mono">
                  {formatCalendarDate(computedFromIncident!)}
                </span>
                )
              </span>
            )}
            {incidentDate && !isManualDate && (
              <span>
                from incident{" "}
                <span className="font-mono">
                  {formatCalendarDate(incidentDate)}
                </span>
              </span>
            )}
            {citation && (
              <span>
                {incidentDate && "·"} per{" "}
                <span className="font-mono">{citation}</span>
              </span>
            )}
          </div>
        )}

        {notes && (
          <div className="text-2xs text-ink-3 leading-relaxed pt-1 border-t border-line/50">
            {notes}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
