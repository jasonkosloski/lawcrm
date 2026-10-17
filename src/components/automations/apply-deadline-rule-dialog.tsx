/**
 * "Apply deadline rule" — matter Deadlines tab (ADR-019).
 *
 * Pick a rule from the firm library and apply it. The action can
 * answer in three ways and this dialog handles each in place:
 *   - ok          → close; revalidation refreshes the table
 *   - duplicate   → the rule is already on this matter: confirm
 *                   "Apply again" (resends with force)
 *   - needs_date  → the anchor couldn't be resolved (a "date entered
 *                   when applied" rule, no incident date, or the
 *                   anchor rule isn't on the matter): ask for it and
 *                   resend with anchorDate
 * Rendered only for holders of deadlines.create (the action rechecks).
 */

"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { applyDeadlineRuleToMatter } from "@/app/actions/automations";
import type { ApplyRuleResult } from "@/lib/automation-form";

export type ApplicableRule = {
  id: string;
  title: string;
  /** e.g. "182 days after Incident date" */
  summary: string;
};

const selectCls =
  "h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30";

export function ApplyDeadlineRuleDialog({
  matterId,
  rules,
}: {
  matterId: string;
  rules: ApplicableRule[];
}) {
  const [open, setOpen] = useState(false);
  const [ruleId, setRuleId] = useState("");
  const [anchorDate, setAnchorDate] = useState("");
  const [result, setResult] = useState<ApplyRuleResult | null>(null);
  // Once the user confirmed "Apply again", every later submit for this
  // rule stays forced. A rule can be BOTH a duplicate and in need of a
  // date; without this the force flag was dropped when the date step
  // appeared and the server answered "duplicate" forever.
  const [forced, setForced] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setRuleId(rules[0]?.id ?? "");
    setAnchorDate("");
    setResult(null);
    setForced(false);
  };

  const submit = (opts: { force?: boolean } = {}) => {
    const force = forced || opts.force;
    if (opts.force) setForced(true);
    startTransition(async () => {
      const res = await applyDeadlineRuleToMatter(matterId, ruleId, {
        force: force || undefined,
        anchorDate: anchorDate || undefined,
      });
      if (res.status === "ok") {
        setOpen(false);
        return;
      }
      setResult(res);
    });
  };

  const selected = rules.find((r) => r.id === ruleId);
  const needsDate = result?.status === "needs_date";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium bg-white text-ink-2 border border-line hover:border-brand-300 hover:text-brand-700 transition-colors"
      >
        <CalendarPlus size={13} />
        Apply deadline rule
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply a deadline rule</DialogTitle>
            <DialogDescription>
              Calculates the due date from the firm&apos;s rule and adds it to
              this matter&apos;s deadlines.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-2xs font-mono uppercase tracking-wider text-ink-4">
                Rule
              </span>
              <select
                value={ruleId}
                onChange={(e) => {
                  setRuleId(e.target.value);
                  setResult(null);
                  setAnchorDate("");
                  setForced(false);
                }}
                className={selectCls}
              >
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
              {selected && (
                <span className="text-2xs text-ink-4">{selected.summary}</span>
              )}
            </label>

            {needsDate && (
              <label className="flex flex-col gap-1">
                <span className="text-2xs font-mono uppercase tracking-wider text-ink-4">
                  {result.label}
                </span>
                <input
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchorDate(e.target.value)}
                  className={selectCls}
                  autoFocus
                />
                <span className="text-2xs text-ink-4">
                  Needed because {result.reason}.
                </span>
              </label>
            )}

            {result?.status === "duplicate" && (
              <Notice>
                &ldquo;{result.title}&rdquo; is already on this matter. Apply it
                again to add a second deadline?
              </Notice>
            )}
            {result?.status === "error" && <Notice>{result.error}</Notice>}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {result?.status === "duplicate" ? (
              <Button size="sm" disabled={pending} onClick={() => submit({ force: true })}>
                {pending ? "Applying…" : "Apply again"}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={pending || !ruleId || (needsDate && !anchorDate)}
                onClick={() => submit()}
              >
                {pending ? "Applying…" : "Apply"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
      <TriangleAlert size={12} className="shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}
