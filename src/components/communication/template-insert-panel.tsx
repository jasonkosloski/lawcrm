/**
 * "Use template" for the email composers — an inline panel (not a nested
 * dialog) that lists the record's email templates, fills the chosen one on
 * the server (`renderMessageTemplate`, access-checked) and hands the
 * subject + body to the composer. When the template uses recipient fields
 * a recipient select appears and the fill re-runs on change; the
 * recipient's email is offered to the composer's To field. Callers key it
 * by the record (`templatePanelKey`) so a new record starts it fresh.
 */

"use client";

import { useEffect, useState, useTransition } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/matters/captures/primary-fields";
import {
  listMessageTemplateOptions,
  renderMessageTemplate,
  type MessageTemplateOption,
  type RenderedMessage,
} from "@/app/actions/message-templates";
import type { RecipientOption } from "@/lib/templates/generate-options";
import type { RecordScope } from "@/lib/record-scope";
import { EMAIL_FORMATTING_NOTE } from "@/lib/template-constants";

export type InsertedTemplate = {
  subject: string | null;
  html: string;
  recipientEmail: string | null;
};

/** Re-mount key: a different record means different templates and contacts. */
export const templatePanelKey = (scope: RecordScope | null): string =>
  scope ? JSON.stringify(scope) : "none";

const REPLACES_NOTE = "Inserting replaces the text you've written; your signature stays.";

export function TemplateInsertPanel({
  scope,
  disabled = false,
  draftHasContent,
  onInsert,
  withSubject = true,
}: {
  /** The record the email is filed to; templates need one. */
  scope: RecordScope | null;
  disabled?: boolean;
  draftHasContent: boolean;
  onInsert: (t: InsertedTemplate) => void;
  /** Replies keep the thread's subject. */
  withSubject?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplateOption[] | null>(null);
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [result, setResult] = useState<RenderedMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    if (!open || !scope || templates) return;
    let live = true;
    listMessageTemplateOptions("email", scope)
      .then((res) => {
        if (!live) return;
        if (res.ok) {
          setTemplates(res.templates);
          setRecipients(res.recipients);
        } else setError(res.error);
      })
      .catch(() => live && setError("Couldn't load templates. Try again."));
    return () => {
      live = false;
    };
  }, [open, scope, templates]);

  const fill = (id: string, recipient: string) => {
    if (!scope || !id) {
      setResult(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await renderMessageTemplate(id, scope, {
          recipientContactId: recipient || null,
        });
        if (res.ok) setResult(res);
        else {
          setResult(null);
          setError(res.error);
        }
      } catch {
        setError("Couldn't fill the template. Try again.");
      }
    });
  };

  if (!open) {
    return (
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={disabled || !scope}
          title={scope ? undefined : "Choose a matter or lead first"}
          onClick={() => setOpen(true)}
        >
          <FileText size={12} />
          Use template
        </Button>
      </div>
    );
  }

  const recipient = recipients.find((r) => r.id === recipientId) ?? null;
  const report = result?.report;

  return (
    <div
      role="group"
      aria-label="Use a template"
      className="flex flex-col gap-2 rounded-md border border-line p-2"
    >
      {templates === null && !error ? (
        <p className="text-2xs text-ink-3">Loading templates…</p>
      ) : templates && templates.length === 0 ? (
        <p className="text-2xs text-ink-3">No email templates fit this record.</p>
      ) : templates ? (
        <SelectField
          name="templateId"
          ariaLabel="Template"
          capitalize={false}
          value={templateId}
          onChange={(v) => {
            setTemplateId(v);
            fill(v, recipientId);
          }}
          options={[
            { value: "", label: "Choose a template…" },
            ...templates.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
      ) : null}

      {result?.needsRecipient && (
        <SelectField
          name="recipientId"
          ariaLabel="Recipient"
          capitalize={false}
          value={recipientId}
          onChange={(v) => {
            setRecipientId(v);
            fill(templateId, v);
          }}
          options={[
            { value: "", label: "Pick a recipient…" },
            ...recipients.map((r) => ({
              value: r.id,
              label: r.role ? `${r.name} — ${r.role}` : r.name,
            })),
          ]}
        />
      )}

      {isPending && <p className="text-2xs text-ink-3">Filling in…</p>}

      {result && (
        <>
          {withSubject && result.subject && (
            <p className="text-xs text-ink">
              <span className="text-ink-3">Subject: </span>
              {result.subject}
            </p>
          )}
          <div
            data-testid="template-preview"
            className="max-h-40 overflow-auto rounded border border-line p-2 text-xs text-ink"
            // Sanitized by resolvedToHtml (document profile).
            dangerouslySetInnerHTML={{ __html: result.html }}
          />
          {report && report.missing.length > 0 && (
            <p className="text-2xs text-warn">Missing: {report.missing.join(", ")}</p>
          )}
          {report && report.invalid.length > 0 && (
            <p className="text-2xs text-warn">
              Fields that don&apos;t apply here: {report.invalid.join(", ")}
            </p>
          )}
          {report && report.archivedBlocks.length > 0 && (
            <p className="text-2xs text-warn">
              Archived blocks: {report.archivedBlocks.join(", ")}
            </p>
          )}
          {result.dropsFormatting && <p className="text-2xs text-ink-3">{EMAIL_FORMATTING_NOTE}</p>}
          {draftHasContent && <p className="text-2xs text-ink-3">{REPLACES_NOTE}</p>}
        </>
      )}

      {error && <p className="text-2xs text-warn">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!result || isPending}
          onClick={() => {
            if (!result) return;
            onInsert({
              subject: withSubject ? result.subject : null,
              html: result.html,
              recipientEmail: recipient?.email ?? null,
            });
            setOpen(false);
          }}
        >
          Insert
        </Button>
      </div>
    </div>
  );
}
