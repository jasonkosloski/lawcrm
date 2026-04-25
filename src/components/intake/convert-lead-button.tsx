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

import { useActionState, useEffect, useMemo, useState } from "react";
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
  const [state, formAction, isPending] = useActionState<
    ConvertLeadFormState,
    FormData
  >(action, convertLeadInitialState);

  const [name, setName] = useState(defaultMatterName);
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [stageId, setStageId] = useState(areas[0]?.stages[0]?.id ?? "");
  const [feeStructure, setFeeStructure] = useState("contingent");

  // Reset stage to the area's first non-terminal stage whenever the
  // user picks a different practice area.
  useEffect(() => {
    const area = areas.find((a) => a.id === areaId);
    if (!area) return;
    const firstNonTerminal =
      area.stages.find((s) => !s.isTerminal) ?? area.stages[0];
    if (firstNonTerminal) setStageId(firstNonTerminal.id);
  }, [areaId, areas]);

  // Reset state when reopened.
  useEffect(() => {
    if (open) {
      setName(defaultMatterName);
      setAreaId(areas[0]?.id ?? "");
      setFeeStructure("contingent");
    }
  }, [open, defaultMatterName, areas]);

  const stagesForArea = useMemo(
    () => areas.find((a) => a.id === areaId)?.stages ?? [],
    [areaId, areas]
  );

  const errs = state.errors ?? {};
  const formError = errs._form?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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

        <form action={formAction} className="flex flex-col gap-3">
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
                  onChange={setAreaId}
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
