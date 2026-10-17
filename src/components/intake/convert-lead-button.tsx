/**
 * Convert Lead Button + Dialog
 *
 * Replaces the disabled "Convert to matter" placeholder in the lead
 * detail topbar. Opens a dialog asking for practice area + initial
 * stage + matter name + fee structure, then calls the
 * `convertLeadToMatter` server action which creates Matter + Contact
 * + team assignment + pin in one transaction and redirects to the
 * new matter.
 */

"use client";

import { useState, useTransition } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  SelectField,
  TextField,
} from "@/components/matters/captures/primary-fields";
import { convertLeadToMatter } from "@/app/actions/leads";
import {
  convertLeadInitialState,
  type ConvertLeadFormState,
} from "@/lib/lead-conversion-form";
import type { PracticeAreaOption } from "@/lib/queries/practice-area-options";

const FEE_OPTIONS = [
  { value: "contingent", label: "Contingent" },
  { value: "hourly", label: "Hourly" },
  { value: "flat", label: "Flat fee" },
  { value: "hybrid", label: "Hybrid" },
  { value: "pro_bono", label: "Pro bono" },
];

// Default stage for a freshly converted matter: terminal stages
// ("Closed", "Declined", …) make no sense as a starting point, so skip
// past them; fall back to the raw first stage if the area only has
// terminal ones.
function firstNonTerminalStage(area: PracticeAreaOption | undefined) {
  return area?.stages.find((s) => !s.isTerminal) ?? area?.stages[0];
}

export function ConvertLeadButton({
  leadId,
  defaultMatterName,
  areas,
}: {
  leadId: string;
  defaultMatterName: string;
  areas: PracticeAreaOption[];
}) {
  const [open, setOpen] = useState(false);
  const action = convertLeadToMatter.bind(null, leadId);
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's error banner doesn't reappear when
  // the dialog is reopened. (Success redirects to the new matter, so
  // there's no close-on-success handling here.) See
  // src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    ConvertLeadFormState,
    FormData
  >(action, convertLeadInitialState, open);

  const [name, setName] = useState(defaultMatterName);
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [stageId, setStageId] = useState(
    firstNonTerminalStage(areas[0])?.id ?? ""
  );
  const [feeStructure, setFeeStructure] = useState("contingent");

  // Seed every field from the CURRENT props each time the dialog opens
  // (done in the open handler, not an effect keyed on the props: a
  // router refresh while the dialog is open hands down a new `areas`
  // array, and that must not wipe what the user has typed). Covers the
  // stale stage a previous open left behind, too.
  const seedFields = () => {
    setName(defaultMatterName);
    setAreaId(areas[0]?.id ?? "");
    setStageId(firstNonTerminalStage(areas[0])?.id ?? "");
    setFeeStructure("contingent");
  };
  const handleOpenChange = (next: boolean) => {
    if (next) seedFields();
    setOpen(next);
  };

  // Picking a different practice area snaps the stage to that area's
  // first non-terminal stage — in the same event, so the stage select
  // never renders a stage that belongs to the previous area.
  const handleAreaChange = (nextAreaId: string) => {
    setAreaId(nextAreaId);
    const stage = firstNonTerminalStage(areas.find((a) => a.id === nextAreaId));
    if (stage) setStageId(stage.id);
  };

  // Manual dispatch: <form action> resets the form after the action
  // settles, even when the server returned a validation error.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  const stagesForArea = areas.find((a) => a.id === areaId)?.stages ?? [];

  const errs = state.errors ?? {};
  const formError = errs._form?.[0];
  // The three selects have no inline error slot, so their server field
  // errors (area/stage retired while the dialog was open, bad fee) are
  // surfaced in one banner — otherwise the submit just silently stops.
  const fieldError =
    errs.practiceAreaId?.[0] ?? errs.stageId?.[0] ?? errs.feeStructure?.[0];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm"><ArrowRight />Convert to matter</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert lead to matter</DialogTitle>
          <DialogDescription>
            Creates the matter, the client contact, and your team assignment in
            one step. The lead&apos;s case summary, location, incident date,
            and injuries become the matter&apos;s description.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {areas.length === 0 ? (
            <div className="text-xs text-warn p-3 rounded-md bg-warn-soft border border-warn-border">
              No practice areas exist yet. Create one in Settings → Practice
              areas before converting a lead.
            </div>
          ) : (
            <>
              <TextField
                name="name"
                value={name}
                onChange={setName}
                placeholder="Matter name"
                error={errs.name?.[0]}
                autoFocus
              />

              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  name="practiceAreaId"
                  value={areaId}
                  onChange={handleAreaChange}
                  options={areas.map((a) => ({ value: a.id, label: a.name }))}
                />
                <SelectField
                  name="stageId"
                  value={stageId}
                  onChange={setStageId}
                  options={stagesForArea.map((s) => ({
                    value: s.id,
                    label: s.name,
                  }))}
                />
              </div>

              <SelectField
                name="feeStructure"
                value={feeStructure}
                onChange={setFeeStructure}
                options={FEE_OPTIONS}
              />

              {fieldError && (
                <div
                  role="alert"
                  className="text-xs text-warn px-3 py-2 rounded-md bg-warn-soft border border-warn-border"
                >
                  {fieldError}
                </div>
              )}
              {formError && (
                <div className="text-xs text-warn px-3 py-2 rounded-md bg-warn-soft border border-warn-border">
                  {formError}
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || areas.length === 0}
            >
              {isPending ? "Converting…" : "Convert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
