/**
 * Convert Lead Button + Dialog
 *
 * Replaces the disabled "Convert to matter" placeholder in the lead
 * detail topbar. Opens a dialog asking for practice area + initial
 * stage + matter name + fee structure, then calls the
 * `convertLeadToMatter` server action which creates Matter + Contact
 * + team assignment + pin in one transaction and redirects to the
 * new matter.
 *
 * Conflict gate (ADR-050): the action re-runs the conflict check. A
 * conflict comes back as a form error; possible conflicts ("warn")
 * come back as `conflictWarnings`, which reveals a review tick that
 * must be checked before the resubmit converts.
 *
 * Engagement block: the matter's originating document (fee agreement /
 * retainer; the area names it). Picks one of the lead's existing
 * documents rather than uploading; the same gate the server runs
 * (agreementGateErrors) runs here first when the firm requires it.
 */

"use client";

import { useState, useTransition } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { ArrowRight, Lock } from "lucide-react";
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
import { AgreementFields } from "@/components/matters/agreement-fields";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, Section } from "@/components/matters/form-primitives";
import {
  SelectField,
  TextField,
} from "@/components/matters/captures/primary-fields";
import { convertLeadToMatter } from "@/app/actions/leads";
import {
  convertLeadInitialState,
  type ConvertLeadFormState,
} from "@/lib/lead-conversion-form";
import {
  agreementGateErrors,
  originatingDocLabel,
} from "@/lib/originating-doc";
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
  restrictedTo,
  documents = [],
  requireOriginatingDoc = false,
  todayKey,
}: {
  leadId: string;
  defaultMatterName: string;
  areas: PracticeAreaOption[];
  /** Set for a restricted lead (ADR-049): the intake team's names,
   *  who become the matter's team; the matter is restricted too. */
  restrictedTo?: string[];
  /** The lead's non-archived documents, offered as the originating one. */
  documents?: Array<{ id: string; name: string }>;
  /** Firm switch: converting needs a signed originating document. */
  requireOriginatingDoc?: boolean;
  /** Today's calendar date (YYYY-MM-DD, firm zone) for the future-date check. */
  todayKey: string;
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
  const [warningsReviewed, setWarningsReviewed] = useState(false);
  const [agreementStatus, setAgreementStatus] = useState("not_sent");
  const [signedDate, setSignedDate] = useState("");
  const [docId, setDocId] = useState("");
  // Client-side gate errors from the last submit attempt; they take
  // precedence over (stale) server errors for the same field.
  const [gateErrors, setGateErrors] = useState<Record<string, string[]>>({});

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
    setWarningsReviewed(false);
    setAgreementStatus("not_sent");
    setSignedDate("");
    setDocId("");
    setGateErrors({});
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
    const found = agreementGateErrors(
      {
        status: agreementStatus,
        signedDate,
        hasOriginatingFile: docId !== "",
      },
      { required: requireOriginatingDoc, label: agreementLabel, today: todayKey }
    );
    // The gate's key for the document is the matter form's; the action
    // (and this dialog's select) call it originatingDocumentId.
    const mapped = Object.fromEntries(
      Object.entries(found).map(([k, v]) => [
        k === "originatingFileId" ? "originatingDocumentId" : k,
        [v as string],
      ])
    );
    setGateErrors(mapped);
    if (Object.keys(mapped).length > 0) return;
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  const stagesForArea = areas.find((a) => a.id === areaId)?.stages ?? [];

  const agreementLabel = originatingDocLabel({
    originatingDocLabel:
      areas.find((a) => a.id === areaId)?.originatingDocLabel ?? null,
  });
  const errs = state.errors ?? {};
  const engagementErrors: Record<string, string[] | undefined> = {
    agreementStatus: gateErrors.agreementStatus ?? errs.agreementStatus,
    agreementSignedDate:
      gateErrors.agreementSignedDate ?? errs.agreementSignedDate,
    originatingDocumentId:
      gateErrors.originatingDocumentId ?? errs.originatingDocumentId,
  };
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
          {restrictedTo && (
            <div className="flex items-start gap-2 text-xs text-ink-2 p-3 rounded-md bg-warn-soft border border-warn-border">
              <Lock size={12} className="text-warn shrink-0 mt-0.5" aria-hidden />
              <span>
                Restricted: the matter will be restricted to{" "}
                {restrictedTo.length > 0 ? restrictedTo.join(", ") : "you"}.
              </span>
            </div>
          )}
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

              <Section title={agreementLabel}>
                <AgreementFields
                  required={requireOriginatingDoc}
                  status={agreementStatus}
                  signedDate={signedDate}
                  onStatusChange={setAgreementStatus}
                  onSignedDateChange={setSignedDate}
                  errors={engagementErrors}
                />
                <Field
                  label={`This is the ${agreementLabel}`}
                  name="originatingDocumentId"
                  required={requireOriginatingDoc}
                  error={engagementErrors.originatingDocumentId}
                >
                  <NativeSelect
                    className="w-full"
                    id="originatingDocumentId"
                    name="originatingDocumentId"
                    value={docId}
                    onChange={(e) => setDocId(e.target.value)}
                    aria-invalid={!!engagementErrors.originatingDocumentId || undefined}
                  >
                    <NativeSelectOption value="">None</NativeSelectOption>
                    {documents.map((d) => (
                      <NativeSelectOption key={d.id} value={d.id}>
                        {d.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </Section>

              {fieldError && (
                <div
                  role="alert"
                  className="text-xs text-warn px-3 py-2 rounded-md bg-warn-soft border border-warn-border"
                >
                  {fieldError}
                </div>
              )}
              {state.conflictWarnings !== undefined && (
                <label className="flex items-start gap-2 text-xs text-ink px-3 py-2 rounded-md bg-warn-soft border border-warn-border cursor-pointer">
                  <input
                    type="checkbox"
                    checked={warningsReviewed}
                    onChange={(e) => setWarningsReviewed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    The conflict check found {state.conflictWarnings} possible{" "}
                    {state.conflictWarnings === 1 ? "conflict" : "conflicts"}{" "}
                    (shown on the lead&apos;s Overview). I&apos;ve reviewed{" "}
                    {state.conflictWarnings === 1 ? "it" : "them"} and they
                    don&apos;t prevent taking this matter.
                  </span>
                </label>
              )}
              <input
                type="hidden"
                name="conflictWarningsReviewed"
                value={warningsReviewed ? "true" : ""}
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
              disabled={
                isPending ||
                areas.length === 0 ||
                (state.conflictWarnings !== undefined && !warningsReviewed)
              }
            >
              {isPending ? "Converting…" : "Convert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
