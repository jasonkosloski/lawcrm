/**
 * Matter Overview card for the originating document (fee agreement /
 * retainer): "{Label}: Signed 2026-10-12 · View document" or
 * "No {Label} on file". Holders of matters.agreement.edit get an inline
 * edit form (status, date signed, document picked from the matter's own
 * documents).
 */

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  updateMatterAgreement,
  type AgreementFormState,
} from "@/app/actions/matter-agreement";
import { AgreementFields } from "./agreement-fields";
import { Field } from "./form-primitives";

const STATUS_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  signed: "Signed",
};

const initial: AgreementFormState = { status: "idle" };

export type AgreementCardProps = {
  matterId: string;
  label: string;
  agreement: {
    status: string;
    /** Date-only YYYY-MM-DD. */
    signedDate: string | null;
    document: { id: string; name: string } | null;
  } | null;
  documents: { id: string; name: string }[];
  canEdit: boolean;
  required: boolean;
};

export function AgreementCard({
  matterId,
  label,
  agreement,
  documents,
  canEdit,
  required,
}: AgreementCardProps) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateMatterAgreement.bind(null, matterId),
    initial
  );
  const [status, setStatus] = useState(agreement?.status ?? "not_sent");
  const [signedDate, setSignedDate] = useState(agreement?.signedDate ?? "");

  // Close the form once per successful save (adjusting state during
  // render, not in an effect).
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.status === "ok") setEditing(false);
  }

  const errs = state.errors ?? {};
  const fieldErrors = {
    agreementStatus: errs.status,
    agreementSignedDate: errs.signedDate,
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{label}</CardTitle>
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-2xs text-brand-700 hover:underline"
            >
              Edit
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {editing ? (
          <form action={formAction} className="flex flex-col gap-3">
            {/* The action reads `status` / `signedDate`; the shared
                controls post their own names, so mirror the values. */}
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="signedDate" value={signedDate} />
            <AgreementFields
              required={required}
              status={status}
              signedDate={signedDate}
              onStatusChange={setStatus}
              onSignedDateChange={setSignedDate}
              errors={fieldErrors}
            />
            <Field
              label="Document"
              name="documentId"
              required={required}
              error={errs.documentId}
            >
              <NativeSelect
                className="w-full"
                id="documentId"
                name="documentId"
                defaultValue={agreement?.document?.id ?? ""}
              >
                <NativeSelectOption value="">None</NativeSelectOption>
                {documents.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {errs._form && (
              <div className="text-2xs text-warn">{errs._form[0]}</div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setStatus(agreement?.status ?? "not_sent");
                  setSignedDate(agreement?.signedDate ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        ) : agreement ? (
          <div className="text-xs text-ink flex flex-wrap items-center gap-x-1.5">
            <span>
              {STATUS_LABELS[agreement.status] ?? agreement.status}
              {agreement.signedDate ? ` ${agreement.signedDate}` : ""}
            </span>
            {agreement.document && (
              <>
                <span className="text-ink-4">·</span>
                <Link
                  href={`/matters/${matterId}/documents/${agreement.document.id}`}
                  className="text-brand-700 hover:underline"
                >
                  View document
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="text-xs text-ink-4">No {label} on file</div>
        )}
      </CardContent>
    </Card>
  );
}
