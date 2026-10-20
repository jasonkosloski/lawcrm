/**
 * Capture Composer Shell — shared chrome for every primary composer
 * (task, event, deadline, time, and note).
 *
 * Collapses to a single-line "Add …" button; on click expands into
 * a Card-wrapped form with the primary fields (rendered as children)
 * plus the CaptureStack below and a Save/Cancel footer. Handles the
 * hidden `attachments` JSON serialization so parents don't have to
 * think about it — they just pass `captures` state.
 *
 * The parent owns the form action + primary-field state + reset
 * behavior. The shell is pure chrome, plus the submit plumbing: it
 * dispatches the action manually (see `onSubmit`) so a validation
 * error doesn't wipe what the user typed, and it shows the
 * form-level error (`formError`) that no field renders.
 */

"use client";

import { useTransition } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { CaptureStack } from "./capture-stack";
import type { CaptureKind, NoteCapture } from "@/lib/note-constants";

export function CaptureComposerShell({
  collapsedLabel,
  primaryLabel,
  expanded,
  onExpand,
  onCancel,
  formAction,
  isPending,
  hasContent,
  captures,
  onCapturesChange,
  attachmentErrors,
  allowedKinds,
  canPin,
  formError,
  children,
}: {
  /** Text shown on the collapsed-state button. */
  collapsedLabel: string;
  /** Singular noun used in the Save button ("task", "event"…). */
  primaryLabel: string;
  expanded: boolean;
  onExpand: () => void;
  onCancel: () => void;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  /** True when the primary form has enough input to submit. Gates
   *  the Save button so the user can't submit an empty primary. */
  hasContent: boolean;
  captures: NoteCapture[];
  onCapturesChange: (next: NoteCapture[]) => void;
  attachmentErrors?: Record<string, Record<string, string[]>>;
  allowedKinds: CaptureKind[];
  /** Whether the viewer may pin a sibling note (`notes.pin`). */
  canPin?: boolean;
  /** Form-level error (e.g. the matter no longer exists) — shown above
   *  the Save row so a failed save is never silent. */
  formError?: string;
  /** Primary form fields — parent renders them inside the <form>. */
  children: React.ReactNode;
}) {
  // Dispatch via onSubmit + startTransition instead of
  // <form action={formAction}>: React 19 resets every form-action form
  // after the action settles — error or not — which would wipe the
  // typed fields (and snap selects back) whenever the server returns a
  // validation error. A manual dispatch keeps the user's input so they
  // can correct and resubmit.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  return (
    <Card className={cn(expanded && "border-brand-200")}>
      <CardContent className="p-3">
        {!expanded ? (
          <button
            type="button"
            onClick={onExpand}
            className={cn(
              "flex items-center gap-2 h-9 px-3 text-xs text-ink-4 w-full",
              "rounded-md border border-dashed border-line bg-white",
              "hover:border-brand-300 hover:text-brand-700 transition-colors text-left"
            )}
          >
            <Plus size={14} />
            {collapsedLabel}
          </button>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <input
              type="hidden"
              name="attachments"
              value={JSON.stringify(captures)}
            />

            {/* Primary form fields from the parent. */}
            {children}

            <CaptureStack
              captures={captures}
              onChange={onCapturesChange}
              errors={attachmentErrors}
              allowedKinds={allowedKinds}
              canPin={canPin}
            />

            {formError && (
              <div role="alert" className="text-xs text-warn">
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="text-xs text-ink-3 hover:text-ink-2 px-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending || !hasContent}
                className={cn(
                  "inline-flex items-center h-7 px-3 rounded-md text-xs font-medium bg-brand-700 text-white",
                  "hover:bg-brand-900 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                )}
              >
                {isPending
                  ? "Saving…"
                  : captures.length > 0
                    ? `Save ${primaryLabel} + ${captures.length}`
                    : `Save ${primaryLabel}`}
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
