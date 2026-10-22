/**
 * "Text from template" — fill a text-message template against a matter or
 * lead for a contact with a phone number, then Copy it (to send from your
 * own phone) or Copy and log it as an outbound text on the contact's
 * thread. There's no SMS provider yet; when one lands, Copy becomes Send.
 *
 * Shown beside "Log call" (same `communication.log_call` gate). Lead texts
 * log unfiled (MessengerItem files to matters only), like lead calls.
 */

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/matters/captures/primary-fields";
import {
  listMessageTemplateOptions,
  renderMessageTemplate,
  type MessageTemplateOption,
  type RenderedMessage,
} from "@/app/actions/message-templates";
import { logText } from "@/app/actions/calls";
import { smsCountLabel, smsStats } from "@/components/templates/editor/sms-count";
import { notifySuccess } from "@/lib/feedback";
import type { RecipientOption } from "@/lib/templates/generate-options";
import type { RecordScope } from "@/lib/record-scope";

export function TextFromTemplateButton({ scope }: { scope: RecordScope }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplateOption[] | null>(null);
  const [contacts, setContacts] = useState<RecipientOption[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [contactId, setContactId] = useState("");
  const [result, setResult] = useState<RenderedMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || templates) return;
    let live = true;
    listMessageTemplateOptions("sms", scope)
      .then((res) => {
        if (!live) return;
        if (res.ok) {
          setTemplates(res.templates);
          // Only contacts you can text.
          setContacts(res.recipients.filter((r) => r.phone));
        } else setError(res.error);
      })
      .catch(() => live && setError("Couldn't load templates. Try again."));
    return () => {
      live = false;
    };
  }, [open, scope, templates]);

  const fill = (tid: string, cid: string) => {
    if (!tid) {
      setResult(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await renderMessageTemplate(tid, scope, { recipientContactId: cid || null });
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

  const message = result?.text.trim() ?? "";
  const contact = contacts.find((c) => c.id === contactId) ?? null;

  const copy = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(message);
      return true;
    } catch {
      setError("Couldn't copy — select the text and copy it yourself.");
      return false;
    }
  };

  const copyAndLog = () => {
    if (!contact) return;
    startTransition(async () => {
      if (!(await copy())) return;
      try {
        const res = await logText({
          contactId: contact.id,
          matterId: scope.kind === "matter" ? scope.matterId : null,
          body: message,
        });
        if (res.ok) {
          notifySuccess(`Copied and logged a text to ${contact.name}.`);
          setOpen(false);
          router.refresh();
        } else setError(res.error);
      } catch {
        setError("Copied, but the text couldn't be logged. Try again.");
      }
    });
  };

  const stats = smsStats(message);
  const report = result?.report;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        onClick={() => setOpen(true)}
      >
        <MessageSquareText size={12} />
        <span className="hidden sm:inline">Text from template</span>
      </Button>
      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Text from template</DialogTitle>
            <DialogDescription>
              Fill a text, then copy it to send from your phone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {templates === null && !error ? (
              <p className="text-2xs text-ink-3">Loading templates…</p>
            ) : templates && templates.length === 0 ? (
              <p className="text-2xs text-ink-3">No text templates fit this record.</p>
            ) : templates ? (
              <>
                <SelectField
                  name="templateId"
                  ariaLabel="Template"
                  capitalize={false}
                  value={templateId}
                  onChange={(v) => {
                    setTemplateId(v);
                    fill(v, contactId);
                  }}
                  options={[
                    { value: "", label: "Choose a template…" },
                    ...templates.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
                <SelectField
                  name="contactId"
                  ariaLabel="Contact"
                  capitalize={false}
                  value={contactId}
                  onChange={(v) => {
                    setContactId(v);
                    fill(templateId, v);
                  }}
                  options={[
                    {
                      value: "",
                      label: contacts.length ? "Text to…" : "No contacts with a phone number",
                    },
                    ...contacts.map((c) => ({
                      value: c.id,
                      label: c.role ? `${c.name} — ${c.role}` : c.name,
                    })),
                  ]}
                />
              </>
            ) : null}

            {result && (
              <>
                <p
                  data-testid="text-preview"
                  className="whitespace-pre-wrap rounded border border-line p-2 text-xs text-ink"
                >
                  {message}
                </p>
                <p className="text-2xs text-ink-3">{smsCountLabel(stats)}</p>
                {report && report.missing.length > 0 && (
                  <p className="text-2xs text-warn">Missing: {report.missing.join(", ")}</p>
                )}
                {report && report.invalid.length > 0 && (
                  <p className="text-2xs text-warn">
                    Fields that don&apos;t apply here: {report.invalid.join(", ")}
                  </p>
                )}
              </>
            )}
            {isPending && <p className="text-2xs text-ink-3">Working…</p>}
            {error && <p className="text-2xs text-warn">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!message || isPending}
              onClick={() => {
                void copy().then((ok) => ok && notifySuccess("Copied."));
              }}
            >
              Copy
            </Button>
            <Button type="button" disabled={!message || !contact || isPending} onClick={copyAndLog}>
              Copy and log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
