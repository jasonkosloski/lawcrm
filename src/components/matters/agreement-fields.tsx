/**
 * Status + signed-date controls for a matter's originating document
 * (fee agreement / retainer). Presentational only, shared by the
 * /matters/new engagement section and the lead conversion dialog, so
 * neither drags the other's upload or document-picking logic along.
 */

"use client";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { AGREEMENT_STATUSES } from "@/lib/originating-doc";
import { Row } from "./form-primitives";
import { Field, inputClass } from "@/components/ui/field";

const STATUS_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  signed: "Signed",
};

export function AgreementFields({
  required,
  status,
  signedDate,
  onStatusChange,
  onSignedDateChange,
  errors,
}: {
  required: boolean;
  status: string;
  signedDate: string;
  onStatusChange: (v: string) => void;
  onSignedDateChange: (v: string) => void;
  errors?: Record<string, string[] | undefined>;
}) {
  const err = (k: string) => errors?.[k]?.[0];
  return (
    <Row>
      <Field
        label="Status"
        htmlFor="agreementStatus"
        required={required}
        error={errors?.agreementStatus}
      >
        <NativeSelect
          className="w-full"
          id="agreementStatus"
          name="agreementStatus"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          aria-invalid={!!err("agreementStatus") || undefined}
        >
          {AGREEMENT_STATUSES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {STATUS_LABELS[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field
        label="Date signed"
        htmlFor="agreementSignedDate"
        required={required}
        error={errors?.agreementSignedDate}
      >
        <input
          id="agreementSignedDate"
          name="agreementSignedDate"
          type="date"
          value={signedDate}
          onChange={(e) => onSignedDateChange(e.target.value)}
          className={inputClass(!!err("agreementSignedDate"))}
        />
      </Field>
    </Row>
  );
}
