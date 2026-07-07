/**
 * Editable Line Item Row — inline-edit replacement for the static
 * line-item row in `InvoicePreview`.
 *
 * UX: each editable value is rendered as a clickable span. Click
 * flips that single cell into an input (date / number / text /
 * textarea); blur or Enter commits, Escape reverts. Save fires
 * the `updateInvoiceLineItem` action with the row's current
 * values — the action is whole-row-update, but the row holds
 * local state so single-cell edits don't need to know the rest.
 *
 * Why not the dialog: a pencil + modal is heavyweight for a
 * small typo fix. Inline editing matches Airtable / Sheets muscle
 * memory and keeps the user in the document.
 *
 * The amount column stays read-only — it's derived from
 * hours × rate. Editing the components updates the displayed
 * amount immediately (driven by the local state), and the server
 * recomputes authoritatively.
 *
 * Auth: the parent (`InvoicePreview`) decides whether to render
 * this row or the static one based on author / `time_entries.edit_any`.
 * The server still gates — defense-in-depth for stale UI.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { updateInvoiceLineItem } from "@/app/actions/billing";
import { formatDate, parseLocalDate } from "@/lib/format-date";
import { lineItemEditInitialState } from "@/lib/billing-form";

type Field = "date" | "activity" | "narrative" | "hours" | "rate";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const toIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatDateShort = (iso: string): string => {
  // Render `YYYY-MM-DD` back to "Apr 15" for view mode. Parse as
  // local date (not UTC) so the day doesn't slip a timezone over.
  const date = parseLocalDate(iso);
  return date ? formatDate(date, "short") : iso;
};

type RowState = {
  date: string;
  activity: string;
  narrative: string;
  hours: string;
  rate: string;
};

export function EditableLineItemRow({
  timeEntryId,
  initial,
  userName,
  userJobTitle,
}: {
  timeEntryId: string;
  initial: {
    date: Date;
    activity: string;
    narrative: string | null;
    hours: number;
    rate: number | null;
  };
  /** "Jason Kosloski" — the timekeeper's full name. */
  userName: string;
  /** "Managing Partner" — the timekeeper's display title. */
  userJobTitle: string;
}) {
  // Local working state for the row. The action operates on the
  // whole tuple, so a single-cell edit composes with the row's
  // last-known values.
  const [committed, setCommitted] = useState<RowState>({
    date: toIso(initial.date),
    activity: initial.activity,
    narrative: initial.narrative ?? "",
    hours: String(initial.hours),
    rate: initial.rate !== null ? String(initial.rate) : "",
  });
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // If the server-rendered row updates after revalidate, sync the
  // local committed state to the new initial — otherwise the row
  // would show stale values until the next full reload.
  useEffect(() => {
    setCommitted({
      date: toIso(initial.date),
      activity: initial.activity,
      narrative: initial.narrative ?? "",
      hours: String(initial.hours),
      rate: initial.rate !== null ? String(initial.rate) : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initial.date.getTime(),
    initial.activity,
    initial.narrative,
    initial.hours,
    initial.rate,
  ]);

  const beginEdit = (field: Field) => {
    if (pending) return;
    setEditing(field);
    setDraft(committed[field]);
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  const commitField = (field: Field, raw: string) => {
    // Strip outer whitespace (internal whitespace survives — matters
    // for the narrative textarea). Two things depend on this: the
    // no-op check below must treat "Research " as unchanged from
    // "Research", and the narrative is client-facing invoice text
    // that the server schema does NOT trim.
    const value = raw.trim();
    // No-op when nothing changed; flip back to view mode without
    // a server round-trip.
    if (value === committed[field]) {
      setEditing(null);
      setDraft("");
      return;
    }
    const next: RowState = { ...committed, [field]: value };
    // Optimistic local update — view mode shows the new value
    // immediately; if the server rejects, we revert + surface the
    // error.
    setCommitted(next);
    setEditing(null);
    setDraft("");

    const fd = new FormData();
    fd.set("date", next.date);
    fd.set("activity", next.activity);
    fd.set("narrative", next.narrative);
    fd.set("hours", next.hours);
    fd.set("rate", next.rate);

    startTransition(async () => {
      const res = await updateInvoiceLineItem(
        timeEntryId,
        lineItemEditInitialState,
        fd
      );
      if (res.status === "error") {
        // Revert the optimistic change. Surface the error inline
        // — the row's last cell will render a small warn note.
        setCommitted(committed);
        const fieldErr = res.errors?.[field]?.[0];
        setError(fieldErr ?? res.error ?? "Couldn't save change.");
      } else {
        setError(null);
      }
    });
  };

  // Live amount preview — hours × rate when both are present.
  const previewAmount = (() => {
    const h = Number(committed.hours);
    const r = Number(committed.rate);
    if (!Number.isFinite(h) || h <= 0) return null;
    if (!committed.rate || !Number.isFinite(r) || r <= 0) return null;
    return h * r;
  })();

  // ── Cell renderers ────────────────────────────────────────────────────

  const cellClass =
    "cursor-text rounded-sm hover:bg-paper-2 transition-colors px-1 -mx-1";
  const inputBase =
    "border border-brand-300 rounded-sm px-1 -mx-1 bg-white text-ink text-2xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200";

  const onKeyDown =
    (field: Field) =>
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !(e.shiftKey && field === "narrative")) {
        e.preventDefault();
        commitField(field, e.currentTarget.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    };

  return (
    <tr className="border-b border-line/60 last:border-b-0 align-top">
      {/* Date */}
      <td className="py-2 font-mono text-ink-3 whitespace-nowrap pr-3">
        {editing === "date" ? (
          <AutoFocusInput
            type="date"
            defaultValue={draft}
            className={cn(inputBase, "font-mono w-[7.5rem]")}
            onBlur={(e) => commitField("date", e.currentTarget.value)}
            onKeyDown={onKeyDown("date")}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            onClick={() => beginEdit("date")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                beginEdit("date");
              }
            }}
            className={cellClass}
          >
            {formatDateShort(committed.date)}
          </span>
        )}
      </td>

      {/* Description (activity + narrative + initials) */}
      <td className="py-2 pr-3">
        {/* Activity */}
        <div>
          {editing === "activity" ? (
            <AutoFocusInput
              type="text"
              defaultValue={draft}
              maxLength={200}
              className={cn(inputBase, "w-full")}
              onBlur={(e) => commitField("activity", e.currentTarget.value)}
              onKeyDown={onKeyDown("activity")}
            />
          ) : (
            <span
              role="button"
              tabIndex={0}
              onClick={() => beginEdit("activity")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  beginEdit("activity");
                }
              }}
              className={cn("text-ink", cellClass)}
            >
              {committed.activity}
            </span>
          )}
        </div>

        {/* Narrative — empty in view mode renders a placeholder
            click target so users can add a narrative without
            opening a separate dialog. */}
        <div className="mt-0.5">
          {editing === "narrative" ? (
            <AutoFocusTextarea
              defaultValue={draft}
              maxLength={4000}
              rows={2}
              className={cn(inputBase, "w-full resize-y")}
              onBlur={(e) =>
                commitField("narrative", e.currentTarget.value)
              }
              onKeyDown={onKeyDown("narrative")}
            />
          ) : committed.narrative.length > 0 ? (
            <span
              role="button"
              tabIndex={0}
              onClick={() => beginEdit("narrative")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  beginEdit("narrative");
                }
              }}
              className={cn("text-ink-4", cellClass)}
            >
              {committed.narrative}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => beginEdit("narrative")}
              className="text-ink-4 italic hover:text-ink-3 transition-colors text-2xs"
            >
              + add narrative
            </button>
          )}
        </div>

        <div className="text-ink-4 mt-0.5">
          {userName}
          <span className="text-ink-4"> — {userJobTitle}</span>
        </div>

        {/* Inline error indicator. Sits under the description so
            it has room to wrap; clears on the next successful
            save. */}
        {error && (
          <div className="text-2xs text-warn mt-0.5" role="alert">
            {error}
          </div>
        )}
      </td>

      {/* Hours */}
      <td className="py-2 text-right font-mono text-ink-3 whitespace-nowrap">
        {editing === "hours" ? (
          <AutoFocusInput
            type="number"
            step="0.1"
            min="0.1"
            max="24"
            defaultValue={draft}
            className={cn(inputBase, "w-16 text-right")}
            onBlur={(e) => commitField("hours", e.currentTarget.value)}
            onKeyDown={onKeyDown("hours")}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            onClick={() => beginEdit("hours")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                beginEdit("hours");
              }
            }}
            className={cellClass}
          >
            {Number(committed.hours).toFixed(2)}
          </span>
        )}
      </td>

      {/* Rate */}
      <td className="py-2 text-right font-mono text-ink-3 whitespace-nowrap">
        {editing === "rate" ? (
          <AutoFocusInput
            type="number"
            step="0.01"
            min="0"
            defaultValue={draft}
            placeholder="$/hr"
            className={cn(inputBase, "w-20 text-right")}
            onBlur={(e) => commitField("rate", e.currentTarget.value)}
            onKeyDown={onKeyDown("rate")}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            onClick={() => beginEdit("rate")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                beginEdit("rate");
              }
            }}
            className={cellClass}
          >
            {committed.rate && Number(committed.rate) > 0
              ? formatMoney(Number(committed.rate))
              : "—"}
          </span>
        )}
      </td>

      {/* Amount — derived, read-only. */}
      <td className="py-2 text-right font-mono text-ink whitespace-nowrap pl-3">
        {pending ? (
          <span className="text-ink-4">…</span>
        ) : previewAmount !== null ? (
          formatMoney(previewAmount)
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

// Auto-focus + select-on-mount helpers. Plain HTML inputs don't
// auto-select on programmatic focus; this gives the click-to-edit
// flow the "type to replace" feel users expect.

function AutoFocusInput(
  props: React.InputHTMLAttributes<HTMLInputElement>
): React.ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (el.type === "text" || el.type === "number") {
      el.select();
    }
  }, []);
  return <input ref={ref} {...props} />;
}

function AutoFocusTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return <textarea ref={ref} {...props} />;
}
