/**
 * Bar admissions editor — rows of (state, bar number) for an attorney.
 *
 * Posts as ONE hidden input, `barAdmissions`, holding a JSON array of
 * `{ state, number }`. The input is always rendered (zero rows posts
 * "[]") so removing every row actually clears the stored admissions;
 * the server treats an absent field as "leave unchanged". Rows missing
 * a state or a number are left out of the JSON.
 */

"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { US_STATES } from "@/lib/us-states";
import type { BarAdmissionInput } from "@/lib/bar-admissions";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { FieldError, inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

type Row = BarAdmissionInput & { key: number };

export function BarAdmissionsField({
  defaultValue,
  error,
}: {
  defaultValue: BarAdmissionInput[];
  error?: string;
}) {
  const nextKey = useRef(defaultValue.length);
  const [rows, setRows] = useState<Row[]>(() => defaultValue.map((r, i) => ({ ...r, key: i })));

  const update = (key: number, patch: Partial<BarAdmissionInput>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const json = JSON.stringify(
    rows
      .map((r) => ({ state: r.state, number: r.number.trim() }))
      .filter((r) => r.state && r.number),
  );

  return (
    <fieldset className="flex flex-col gap-1.5 border-0 p-0 m-0 min-w-0">
      <legend className={`${labelClass} p-0 mb-1`}>Bar admissions</legend>
      <input type="hidden" name="barAdmissions" value={json} />
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <NativeSelect
            aria-label="State"
            value={r.state}
            onChange={(e) => update(r.key, { state: e.target.value })}
            className="w-44 shrink-0"
            aria-invalid={!!error || undefined}
          >
            <NativeSelectOption value="">Select a state</NativeSelectOption>
            {US_STATES.map((s) => (
              <NativeSelectOption key={s.code} value={s.code}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <input
            type="text"
            aria-label="Bar number"
            maxLength={40}
            value={r.number}
            onChange={(e) => update(r.key, { number: e.target.value })}
            placeholder="Bar number"
            className={`${inputClass(!!error, "md")} min-w-0 flex-1`}
          />
          <button
            type="button"
            aria-label="Remove admission"
            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            className="p-1.5 text-ink-4 hover:text-ink-2 rounded-md"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            setRows((rs) => [...rs, { key: nextKey.current++, state: "", number: "" }])
          }
        >
          <Plus size={12} />
          Add admission
        </Button>
      </div>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <span className="text-3xs text-ink-4 leading-relaxed">Attorneys only.</span>
      )}
    </fieldset>
  );
}
