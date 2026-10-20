/**
 * Expense form fields — shared by the "Log expense" composer and the
 * Edit expense dialog so the two can never drift (same names the
 * expense actions parse, same validation surfacing).
 *
 * Controlled by one `ExpenseDraft`. Dates are calendar-day keys
 * (ADR-012): callers seed `date` from `todayKey(tz)` or the server's
 * `dateOnlyKey(expense.date)`, never from a browser `Date`.
 */

"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  type ExpenseCategory,
} from "@/lib/expense-constants";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export type ExpenseDocumentOption = {
  id: string;
  name: string;
};

export type ExpenseDraft = {
  /** YYYY-MM-DD */
  date: string;
  /** As typed, e.g. "125.50". */
  amount: string;
  description: string;
  category: ExpenseCategory;
  utbmsCode: string;
  billable: boolean;
  clientAdvanced: boolean;
  notes: string;
  /** "" = no receipt. */
  receiptDocumentId: string;
};

export function blankExpenseDraft(todayKey: string): ExpenseDraft {
  return {
    date: todayKey,
    amount: "",
    description: "",
    category: "filing_fee",
    utbmsCode: "",
    billable: true,
    clientAdvanced: false,
    notes: "",
    receiptDocumentId: "",
  };
}

const inputClass =
  "h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4";

export function ExpenseFields({
  draft,
  onChange,
  errors = {},
  documentOptions = [],
}: {
  draft: ExpenseDraft;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  errors?: Record<string, string[] | undefined>;
  /** Receipt candidates; the picker hides when empty. A receipt
   *  already attached but missing from the list stays selectable. */
  documentOptions?: ExpenseDocumentOption[];
}) {
  const uid = useId();
  // An attached receipt missing from the (capped) list must survive a
  // save — otherwise editing an old expense would silently detach it.
  const receiptOffList =
    draft.receiptDocumentId !== "" &&
    !documentOptions.some((d) => d.id === draft.receiptDocumentId);
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Date" htmlFor={`${uid}-date`} required>
          <input
            id={`${uid}-date`}
            name="date"
            type="date"
            required
            value={draft.date}
            onChange={(e) => onChange({ date: e.target.value })}
            className={cn(inputClass, errors.date && "border-warn")}
          />
          {errors.date && <FieldError>{errors.date[0]}</FieldError>}
        </Field>
        <Field label="Amount" htmlFor={`${uid}-amount`} required>
          <input
            id={`${uid}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            required
            value={draft.amount}
            placeholder="0.00"
            onChange={(e) => onChange({ amount: e.target.value })}
            className={cn(inputClass, "font-mono", errors.amount && "border-warn")}
          />
          {errors.amount && <FieldError>{errors.amount[0]}</FieldError>}
        </Field>
        <Field label="Category" htmlFor={`${uid}-category`}>
          <NativeSelect
            className="w-full"
            id={`${uid}-category`}
            name="category"
            value={draft.category}
            onChange={(e) => onChange({ category: e.target.value as ExpenseCategory })}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {EXPENSE_CATEGORY_LABEL[c]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field label="Description" htmlFor={`${uid}-description`} required>
        <input
          id={`${uid}-description`}
          name="description"
          type="text"
          required
          maxLength={400}
          value={draft.description}
          placeholder="Court filing fee — motion to compel"
          onChange={(e) => onChange({ description: e.target.value })}
          className={cn(inputClass, errors.description && "border-warn")}
        />
        {errors.description && <FieldError>{errors.description[0]}</FieldError>}
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="UTBMS code" htmlFor={`${uid}-utbms`}>
          <input
            id={`${uid}-utbms`}
            name="utbmsCode"
            type="text"
            maxLength={20}
            value={draft.utbmsCode}
            placeholder="E.g. E102"
            onChange={(e) => onChange({ utbmsCode: e.target.value })}
            className={inputClass}
          />
        </Field>
        <label className="flex items-center gap-2 text-xs text-ink mt-5">
          <input
            type="checkbox"
            name="billable"
            checked={draft.billable}
            onChange={(e) => onChange({ billable: e.target.checked })}
          />
          Billable
        </label>
        <label className="flex items-center gap-2 text-xs text-ink mt-5">
          <input
            type="checkbox"
            name="clientAdvanced"
            checked={draft.clientAdvanced}
            onChange={(e) => onChange({ clientAdvanced: e.target.checked })}
          />
          Client advanced
        </label>
      </div>

      <Field label="Notes" htmlFor={`${uid}-notes`}>
        <textarea
          id={`${uid}-notes`}
          name="notes"
          rows={2}
          maxLength={1000}
          value={draft.notes}
          placeholder="Optional context for the bill or audit trail"
          onChange={(e) => onChange({ notes: e.target.value })}
          className="px-2.5 py-1.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 resize-none"
        />
      </Field>

      {/* Receipt picker — only when the matter has documents (upload a
          receipt via the Documents tab first). */}
      {documentOptions.length > 0 && (
        <Field label="Receipt" htmlFor={`${uid}-receipt`}>
          <NativeSelect
            className="w-full"
            id={`${uid}-receipt`}
            name="receiptDocumentId"
            value={draft.receiptDocumentId}
            onChange={(e) => onChange({ receiptDocumentId: e.target.value })}
          >
            <NativeSelectOption value="">— No receipt —</NativeSelectOption>
            {receiptOffList && (
              <NativeSelectOption value={draft.receiptDocumentId}>Current receipt</NativeSelectOption>
            )}
            {documentOptions.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      )}
      {/* No picker at all (no documents listed) → still post the
          attached receipt so the save keeps it. */}
      {documentOptions.length === 0 && receiptOffList && (
        <input type="hidden" name="receiptDocumentId" value={draft.receiptDocumentId} />
      )}
    </>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  /** id of the control this label names. */
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-2xs font-medium text-ink-3"
      >
        {label} {required && <span className="text-warn">*</span>}
      </label>
      {children}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs text-warn">{children}</span>;
}
