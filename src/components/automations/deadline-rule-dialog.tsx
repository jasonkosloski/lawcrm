/**
 * Create / edit a deadline rule — Settings → Automations (ADR-019).
 *
 * A rule is "N days/months/years after/before <anchor>". The anchor
 * picker reveals what each kind needs: another rule (for "another
 * rule's deadline") or a label for the date asked at apply time.
 * A live preview line shows exactly how the rule will read.
 */

"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { createDeadlineRule, updateDeadlineRule } from "@/app/actions/automations";
import { automationInitialState, type AutomationFormState } from "@/lib/automation-form";
import {
  DEADLINE_RULE_ANCHORS,
  DEADLINE_RULE_ANCHOR_LABEL,
  OFFSET_UNITS,
  packOffset,
  ruleSummary,
  unpackOffset,
  type DeadlineRuleAnchor,
  type OffsetUnit,
} from "@/lib/automations/deadline-plan";
import type { DeadlineRuleRow } from "@/lib/queries/automations";
import { Field, inputClass, textareaClass } from "@/components/ui/field";

export function DeadlineRuleDialog({
  open,
  onOpenChange,
  rule,
  allRules,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create. */
  rule: DeadlineRuleRow | null;
  /** Candidates for a "rule" anchor (the server refuses loops). */
  allRules: DeadlineRuleRow[];
}) {
  const action = rule ? updateDeadlineRule.bind(null, rule.id) : createDeadlineRule;
  const [state, formAction, isPending] = useDialogActionState<AutomationFormState, FormData>(
    action,
    automationInitialState,
    open,
  );

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("critical");
  const [anchor, setAnchor] = useState<DeadlineRuleAnchor>("incident_date");
  const [anchorRuleId, setAnchorRuleId] = useState("");
  const [anchorLabel, setAnchorLabel] = useState("");
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<OffsetUnit>("days");
  const [direction, setDirection] = useState<"after" | "before">("after");
  const [sourceRef, setSourceRef] = useState("");
  const [description, setDescription] = useState("");

  // Reseed on each open (render-phase reset, like TemplateEditorDialog).
  // Starts "closed" so a dialog first rendered already open seeds too.
  const [prev, setPrev] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  if (open !== prev.open || (rule?.id ?? null) !== prev.id) {
    setPrev({ open, id: rule?.id ?? null });
    if (open) {
      const off = rule ? unpackOffset(rule.offsetDays, rule.offsetUnit) : null;
      setTitle(rule?.title ?? "");
      setKind(rule?.kind ?? "critical");
      setAnchor((rule?.anchor as DeadlineRuleAnchor) ?? "incident_date");
      setAnchorRuleId(rule?.anchorRuleId ?? "");
      setAnchorLabel(rule?.anchorLabel ?? "");
      setAmount(String(off?.amount ?? 30));
      setUnit(off?.unit ?? "days");
      setDirection(off?.direction ?? "after");
      setSourceRef(rule?.sourceRef ?? "");
      setDescription(rule?.description ?? "");
    }
  }

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  const errs = state.errors ?? {};
  // Keep the rule's current anchor selectable even when it's archived
  // (the server accepts archived anchors); otherwise the required
  // select would go blank and force the admin to re-point the rule.
  const candidates = allRules.filter(
    (r) => r.id !== rule?.id && (r.isActive || r.id === rule?.anchorRuleId),
  );
  const n = Number.parseInt(amount, 10);
  const preview =
    Number.isFinite(n) && n >= 0
      ? ruleSummary({
          anchor,
          anchorLabel: anchorLabel || null,
          anchorRuleTitle: candidates.find((r) => r.id === anchorRuleId)?.title ?? null,
          offsetDays: packOffset({ amount: n, unit, direction }),
          offsetUnit: unit,
        })
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit deadline rule" : "New deadline rule"}</DialogTitle>
          <DialogDescription>
            Changes affect future applications only. Deadlines already on matters keep their dates.
            Due dates are plain calendar days: no weekend, holiday or court-day adjustment.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <Field label="Deadline title" error={errs.title?.[0]}>
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              placeholder='e.g. "CGIA notice due"'
              className={inputClass()}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              <NativeSelect
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full"
              >
                <NativeSelectOption value="critical">Critical</NativeSelectOption>
                <NativeSelectOption value="standard">Standard</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field label="Counts from" error={errs.anchor?.[0]}>
              <NativeSelect
                name="anchor"
                value={anchor}
                onChange={(e) => setAnchor(e.target.value as DeadlineRuleAnchor)}
                className="w-full"
              >
                {DEADLINE_RULE_ANCHORS.map((a) => (
                  <NativeSelectOption
                    key={a}
                    value={a}
                    disabled={a === "rule" && candidates.length === 0 && anchor !== "rule"}
                  >
                    {DEADLINE_RULE_ANCHOR_LABEL[a]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>

          {anchor === "incident_date" && (
            <p className="text-3xs text-ink-4 -mt-1.5">
              Only resolves on matters in practice areas that track a statute of limitations
              (that&apos;s where the incident date is recorded). Otherwise the rule asks for a date,
              or becomes a &ldquo;Set date&rdquo; task when applied automatically.
            </p>
          )}
          {anchor === "rule" && (
            <Field label="Which rule's deadline" error={errs.anchorRuleId?.[0]}>
              <NativeSelect
                name="anchorRuleId"
                value={anchorRuleId}
                onChange={(e) => setAnchorRuleId(e.target.value)}
                required
                className="w-full"
              >
                <NativeSelectOption value="">Choose a rule…</NativeSelectOption>
                {candidates.map((r) => (
                  <NativeSelectOption key={r.id} value={r.id}>
                    {r.isActive ? r.title : `${r.title} (archived)`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          {anchor === "prompt" && (
            <Field
              label="What date to ask for"
              error={errs.anchorLabel?.[0]}
              hint="Shown when someone applies the rule, e.g. “Date of service”."
            >
              <input
                name="anchorLabel"
                value={anchorLabel}
                onChange={(e) => setAnchorLabel(e.target.value)}
                maxLength={80}
                placeholder="Date of service"
                className={inputClass()}
              />
            </Field>
          )}

          <Field label="Offset" error={errs.amount?.[0]}>
            <div className="grid grid-cols-[90px_1fr_1fr] gap-2">
              <input
                name="amount"
                type="number"
                min={0}
                max={36500}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className={inputClass()}
                aria-label="Amount"
              />
              <NativeSelect
                name="unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as OffsetUnit)}
                className="w-full"
                aria-label="Unit"
              >
                {OFFSET_UNITS.map((u) => (
                  <NativeSelectOption key={u} value={u}>
                    {u}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                name="direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as "after" | "before")}
                className="w-full"
                aria-label="Direction"
              >
                <NativeSelectOption value="after">after</NativeSelectOption>
                <NativeSelectOption value="before">before</NativeSelectOption>
              </NativeSelect>
            </div>
          </Field>
          {preview && (
            <div className="text-2xs text-ink-3 px-2.5 py-1.5 rounded-md bg-paper-2 border border-line">
              Due: <span className="font-medium text-ink">{preview}</span>
              {unit !== "days" && (
                <span className="block text-ink-4 mt-0.5">
                  Months count as 30 days and years as 365 (same as the statute-of-limitations
                  setting).
                </span>
              )}
            </div>
          )}

          <Field label="Citation (optional)">
            <input
              name="sourceRef"
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              maxLength={200}
              placeholder="C.R.S. § 24-10-109"
              className={inputClass()}
            />
          </Field>
          <Field label="Notes (optional)" hint="Copied onto each generated deadline.">
            <textarea
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={4000}
              className={textareaClass()}
            />
          </Field>

          {errs._form?.[0] && (
            <div className="flex items-center gap-2 text-2xs text-warn">
              <TriangleAlert size={12} /> {errs._form[0]}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : rule ? "Save rule" : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
