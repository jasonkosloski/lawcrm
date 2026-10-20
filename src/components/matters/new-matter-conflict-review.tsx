/**
 * Conflict review on the New-matter form (ADR-054).
 *
 * Rendered when `createMatter` returns a conflict result instead of
 * creating the matter. Possible conflicts need a "reviewed" tick; a
 * conflict needs a written override from someone holding
 * `intake.conflict_check.override`. Either way the form resubmits with
 * `conflictAck` set to the result's fingerprint, so the server can tell
 * the user acknowledged exactly these matches.
 */

"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NewMatterConflict } from "@/lib/new-matter-constants";

export function NewMatterConflictReview({
  conflict,
  reasonError,
  staleError,
  defaultReason,
}: {
  conflict: NewMatterConflict;
  reasonError?: string[];
  /** The resubmit acknowledged an earlier, different result. */
  staleError?: string[];
  defaultReason?: string;
}) {
  const [reviewed, setReviewed] = useState(false);
  const isConflict = conflict.severity === "conflict";
  const blocked = isConflict && !conflict.canOverride;
  const n = conflict.matches.length;

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 p-3 rounded-md border border-warn-border bg-warn-soft/30"
    >
      <div className="flex items-start gap-2 text-xs text-ink">
        <TriangleAlert size={14} className="shrink-0 mt-px text-warn" />
        <div>
          <div className="font-medium">
            {isConflict
              ? "The conflict check found a conflict"
              : `The conflict check found ${n} possible conflict${n === 1 ? "" : "s"}`}
          </div>
          <div className="text-2xs text-ink-3 mt-0.5">
            Checked the client against adverse parties on other matters, and the
            opposing party and firm against the firm&apos;s clients.
          </div>
        </div>
      </div>

      {staleError?.length ? (
        <div className="text-2xs font-medium text-warn">{staleError[0]}</div>
      ) : null}

      <ul className="border border-line rounded-md overflow-hidden divide-y divide-line bg-white">
        {conflict.matches.map((m, i) => (
          <li key={i} className="flex items-start gap-2 px-3 py-2">
            <span
              className={cn(
                "inline-block shrink-0 text-2xs font-medium px-1.5 py-0.5 rounded-full border",
                m.severity === "conflict"
                  ? "bg-warn-soft text-warn border-warn-border"
                  : "bg-paper-2 text-ink-3 border-line"
              )}
            >
              {m.severity === "conflict" ? "Conflict" : "Warn"}
            </span>
            <span className="text-xs text-ink leading-snug">{m.description}</span>
          </li>
        ))}
      </ul>

      {blocked ? (
        <div className="text-2xs text-ink-2">
          Someone with permission to override conflict checks has to create this
          matter, or change the client or opposing party above.
        </div>
      ) : isConflict ? (
        <div className="flex flex-col gap-1">
          <input type="hidden" name="conflictAck" value={conflict.fingerprint} />
          <label
            htmlFor="conflictOverrideReason"
            className="text-xs font-medium text-ink-2"
          >
            Override justification <span className="text-warn">*</span>
          </label>
          <textarea
            id="conflictOverrideReason"
            name="conflictOverrideReason"
            rows={2}
            defaultValue={defaultReason ?? ""}
            aria-invalid={!!reasonError?.length || undefined}
            className="px-2.5 py-1.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 resize-y"
            placeholder="Informed-consent waiver signed; former client, no substantial relationship…"
          />
          {reasonError?.length ? (
            <div className="text-2xs text-warn">{reasonError[0]}</div>
          ) : (
            <div className="text-2xs text-ink-4">
              Recorded on the new matter&apos;s timeline.
            </div>
          )}
        </div>
      ) : (
        <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer select-none">
          <input
            type="checkbox"
            name="conflictAck"
            value={conflict.fingerprint}
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-line"
          />
          I&apos;ve reviewed these possible conflicts
        </label>
      )}
    </div>
  );
}
