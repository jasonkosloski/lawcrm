/**
 * Conflict review for the matter conflict gate (ADR-054): the New-matter
 * form, the matter edit form and the Parties tab composer.
 *
 * Rendered when the action returns a conflict prompt instead of
 * writing. Possible conflicts need a "reviewed" tick; a
 * conflict needs a written override from someone holding
 * `intake.conflict_check.override`. Either way the form resubmits with
 * `conflictAck` set to the result's fingerprint, so the server can tell
 * the user acknowledged exactly these matches.
 */

"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConflictPrompt } from "@/lib/conflict-gate-constants";

export function ConflictReview({
  conflict,
  checked,
  reasonError,
  staleError,
  defaultReason,
  defaultReviewed = false,
}: {
  conflict: ConflictPrompt;
  /** What was screened, e.g. "the opposing party against the firm's
   *  clients". */
  checked: string;
  reasonError?: string[];
  /** The resubmit acknowledged an earlier, different result. */
  staleError?: string[];
  defaultReason?: string;
  /** Already ticked (a later round trip of an acknowledged result). */
  defaultReviewed?: boolean;
}) {
  const [reviewed, setReviewed] = useState(defaultReviewed);
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
          <div className="text-2xs text-ink-3 mt-0.5">Checked {checked}.</div>
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
          Someone with permission to override conflict checks has to make this
          change, or change the names above.
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
              Recorded on the matter&apos;s timeline.
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
