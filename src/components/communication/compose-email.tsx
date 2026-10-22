/**
 * Compose email — "Compose" button + modal for the unified inbox.
 *
 * Mounted by `ComposeEmailLauncher` (server), which resolves the
 * current user's send permission + connected Gmail accounts:
 *   - no connected account → the button becomes a "Connect Gmail"
 *     link to /settings/integrations (rendered here so the state is
 *     component-testable)
 *   - one account → no picker, sends from it
 *   - several → a From select
 *
 * Draft preservation is a hard contract: fields only reset after a
 * successful send — closing the dialog or hitting a send error keeps
 * everything typed. Body is rich text (Email v1.1): the shared
 * Tiptap editor holds HTML; on send it goes up as `bodyHtml` (the
 * server action sanitizes it before the MIME builder) plus an
 * `htmlToText` downgrade as `bodyText`. Attachments are documents of
 * the chosen record (SendAttachmentsField); changing the record clears
 * them. The body starts with the user's signature (`signature`, loaded
 * by the launcher) and resets to it after a send.
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, PenLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  SelectField,
  TextField,
} from "@/components/matters/captures/primary-fields";
import { RichTextEditor } from "@/components/shared/rich-text-editor-lazy";
import { parseAddressList } from "@/lib/google/mime";
import { htmlToText } from "@/lib/html-to-text";
import { isBodyEmpty } from "@/lib/email-signature-body";
import { sendEmail } from "@/app/actions/email-send";
import { notifySuccess } from "@/lib/feedback";
import type { RecordScope } from "@/lib/record-scope";
import type {
  FilingLeadOption,
  FilingMatterOption,
} from "@/lib/queries/communication";
import { blockEnterSubmit, LabeledField } from "./labeled-field";
import { RecordPicker } from "./record-picker";
import { SendAttachmentsField } from "./send-attachments-field";
import type { AttachableDocument } from "@/app/actions/email-send-attachments";
import type { StorageDriver } from "@/lib/storage/storage-key";

/** Shown when the action call itself rejects - the send may or may
 *  not have gone out, so don't invite a blind retry. */
const SEND_UNCONFIRMED =
  "Couldn't confirm the send — check your Sent folder before retrying. Your draft is kept.";

export type SendableEmailAccount = {
  id: string;
  emailAddress: string;
};

export function ComposeEmailButton({
  accounts,
  matters,
  leads,
  initialScope,
  canUpload = false,
  storageDriver,
  signature = null,
}: {
  /** Composer-ready signature HTML (getEmailSignature); null = none. */
  signature?: string | null;
  /** `documents.upload` - offers "Upload new…" in the attach picker. */
  canUpload?: boolean;
  storageDriver?: StorageDriver;
  /** Record options for the required "Matter or lead" field. */
  matters: FilingMatterOption[];
  leads: FilingLeadOption[];
  /** Prefills the record (matter / lead Communication tabs); the
   *  field stays editable and is restored to this on reset. */
  initialScope?: RecordScope;
  /** The current user's connected Gmail accounts. Empty = show the
   *  connect affordance instead of the composer. */
  accounts: SendableEmailAccount[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Draft state lives at THIS level so closing the dialog never
  // loses it — reset happens only on a successful send. `body` is
  // the editor's HTML; the editor re-mounts from it when the dialog
  // reopens (it's uncontrolled after mount).
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(signature ?? "");
  const [scope, setScope] = useState<RecordScope | null>(
    initialScope ?? null,
  );
  const [changingRecord, setChangingRecord] = useState(false);
  const [attachments, setAttachments] = useState<AttachableDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // The From account can disappear from `accounts` while this stays
  // mounted (its grant flipped to error and the launcher re-filtered):
  // never post a stale id - fall back to the first live account.
  const effectiveAccountId = accounts.some((a) => a.id === accountId)
    ? accountId
    : (accounts[0]?.id ?? "");

  if (accounts.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        render={<Link href="/settings/integrations" />}
      >
        <Mail size={12} />
        <span className="hidden sm:inline">Connect Gmail</span>
      </Button>
    );
  }

  const resetDraft = (): void => {
    setTo("");
    setCc("");
    setSubject("");
    setBody(signature ?? "");
    setScope(initialScope ?? null);
    setChangingRecord(false);
    setAttachments([]);
    setError(null);
  };

  // The editor emits tag scaffolding ("<p></p>") for an empty
  // document — gate Send on the visible text, which doubles as the
  // wire's text/plain part.
  const bodyText = htmlToText(body);

  const handleSend = (): void => {
    const toParsed = parseAddressList(to);
    if (toParsed.invalid.length > 0) {
      setError(`Invalid address: ${toParsed.invalid.join(", ")}`);
      return;
    }
    if (toParsed.addresses.length === 0) {
      setError("Add at least one recipient.");
      return;
    }
    const ccParsed = parseAddressList(cc);
    if (ccParsed.invalid.length > 0) {
      setError(`Invalid Cc address: ${ccParsed.invalid.join(", ")}`);
      return;
    }
    if (!scope) {
      setError("Choose a matter or lead.");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const result = await sendEmail(effectiveAccountId, {
          to: toParsed.addresses,
          cc: ccParsed.addresses,
          subject: subject.trim(),
          // Editor HTML goes up as-is — the action sanitizes it
          // (note profile) before it reaches the MIME builder.
          bodyText,
          bodyHtml: body,
          scope,
          attachmentDocumentIds: attachments.map((a) => a.id),
        });
        if (result.ok) {
          resetDraft();
          setOpen(false);
          // Outlives the dialog: e.g. "Added to an existing thread
          // filed to X." when Gmail merged the send into a thread.
          if (result.notice) notifySuccess(result.notice);
          // Surface the locally-upserted sent thread in the list.
          router.refresh();
        } else {
          // Draft preserved — only the error line changes.
          setError(result.error);
        }
      } catch {
        // A rejected action (network drop, or a persistence failure
        // AFTER Gmail accepted the message) must not reach the error
        // boundary: that would discard the draft and invite a
        // duplicate send. Keep the draft and tell the user to check.
        setError(SEND_UNCONFIRMED);
      }
    });
  };

  const scopeLabel = (() => {
    if (!scope) return null;
    if (scope.kind === "matter") {
      return matters.find((m) => m.id === scope.matterId)?.name ?? "Selected matter";
    }
    return leads.find((l) => l.id === scope.leadId)?.name ?? "Selected lead";
  })();

  const fromOptions = accounts.map((a) => ({
    value: a.id,
    label: a.emailAddress,
  }));

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        onClick={() => setOpen(true)}
      >
        <PenLine size={12} />
        <span className="hidden sm:inline">Compose</span>
      </Button>

      {/* Dismissal is ignored mid-send: a failure would otherwise
          land in a closed dialog and the user would believe the
          email went out. */}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && isPending) return;
          setOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New email</DialogTitle>
            <DialogDescription>
              Sends from your connected Gmail account
              {accounts.length === 1 ? (
                <>
                  {" "}
                  (<span className="text-ink-2">{accounts[0].emailAddress}</span>)
                </>
              ) : null}
              .
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            onKeyDown={blockEnterSubmit}
            className="flex flex-col gap-3"
          >
            <div
              role="group"
              aria-labelledby="compose-record-label"
              className="flex flex-col gap-1"
            >
              <span
                id="compose-record-label"
                className="text-2xs font-medium text-ink-3"
              >
                Matter or lead
              </span>
              {scope && !changingRecord ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    data-testid="compose-record"
                    className="flex-1 truncate text-xs text-ink"
                  >
                    {scopeLabel}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending || uploading}
                    onClick={() => setChangingRecord(true)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <RecordPicker
                  matters={matters}
                  leads={leads}
                  value={scope}
                  disabled={isPending || uploading}
                  placeholder="Matter or lead — search to choose"
                  onChange={(next) => {
                    // Attachments belong to the record they came from.
                    if (JSON.stringify(next) !== JSON.stringify(scope)) {
                      setAttachments([]);
                    }
                    setScope(next);
                    setChangingRecord(false);
                  }}
                />
              )}
            </div>

            {accounts.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-2xs font-medium text-ink-3 shrink-0 w-10">
                  From
                </span>
                <div className="flex-1">
                  <SelectField
                    name="accountId"
                    ariaLabel="Send from account"
                    capitalize={false}
                    value={effectiveAccountId}
                    onChange={setAccountId}
                    options={fromOptions}
                  />
                </div>
              </div>
            )}

            <LabeledField label="To">
              <TextField
                name="to"
                value={to}
                onChange={setTo}
                placeholder="To — comma-separated addresses"
                ariaLabel="To"
                autoFocus
              />
            </LabeledField>
            <LabeledField label="Cc">
              <TextField
                name="cc"
                value={cc}
                onChange={setCc}
                placeholder="Cc (optional)"
                ariaLabel="Cc"
              />
            </LabeledField>
            <LabeledField label="Subj">
              <TextField
                name="subject"
                value={subject}
                onChange={setSubject}
                placeholder="Subject"
                ariaLabel="Subject"
              />
            </LabeledField>
            <RichTextEditor
              initialHTML={body}
              onChange={setBody}
              placeholder="Write your email…"
            />
            <SendAttachmentsField
              scope={scope}
              value={attachments}
              onChange={setAttachments}
              disabled={isPending}
              canUpload={canUpload}
              storageDriver={storageDriver}
              onBusyChange={setUploading}
            />

            {error && <div className="text-2xs text-warn">{error}</div>}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  isPending ||
                  uploading ||
                  !scope ||
                  !to.trim() ||
                  isBodyEmpty(body, signature)
                }
              >
                {isPending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
