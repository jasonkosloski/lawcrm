/**
 * Reply composer — the interactive island at the bottom of the email
 * thread reader (both the full /communication reader and the
 * embedded matter/intake reader mount it via ReplySection).
 *
 * Collapsed: "Reply" / "Reply all" affordances (Reply all only when
 * it would actually add recipients). Expanded: server-derived
 * recipients shown read-only with an Edit toggle (comma-separated,
 * client-validated), rich-text body (shared Tiptap editor, Email
 * v1.1 — HTML goes up as `bodyHtml` for server-side sanitizing +
 * an `htmlToText` downgrade as `bodyText`), Send with pending state.
 *
 * Draft contract: the body survives mode switches, collapse, and —
 * critically — send failures; it only clears after a successful
 * send, which then router.refresh()es so the locally-upserted sent
 * message appears in the thread.
 *
 * Recipient honesty: the send ALWAYS posts the exact To/Cc the user
 * is looking at (typed when editing, else the displayed defaults, with
 * `recipientsEdited` telling the server which). The server re-derives
 * for an unedited send and refuses with `recipients_changed` if a sync
 * moved the thread underneath the open composer - we then refresh so
 * the new recipients are visible. The composer is keyed by thread id
 * in ReplySection so switching threads never carries a draft (or its
 * recipients) onto another conversation.
 *
 * Attachments come from the thread's record (or, on an unfiled
 * thread, the record picked to file it to; changing it clears them).
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Reply, ReplyAll } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/matters/captures/primary-fields";
import { RichTextEditor } from "@/components/shared/rich-text-editor-lazy";
import { parseAddressList } from "@/lib/google/mime";
import { htmlToText } from "@/lib/html-to-text";
import { getEmailSignature } from "@/lib/email-signature";
import { replyToThread } from "@/app/actions/email-send";
import { REPLY_NEEDS_FILER_ERROR } from "@/lib/email-send-status";
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

export type ReplyRecipient = { name?: string; email: string };
export type ReplyDefaults = { to: ReplyRecipient[]; cc: ReplyRecipient[] };

type Mode = "reply" | "replyAll";

const formatRecipient = (r: ReplyRecipient): string =>
  r.name ? `${r.name} <${r.email}>` : r.email;

const toInputValue = (list: ReplyRecipient[]): string =>
  list.map((r) => r.email).join(", ");

export function ReplyComposer({
  threadId,
  accountEmail,
  reply,
  replyAll,
  needsRecord,
  recordScope = null,
  canFile,
  canUpload = false,
  storageDriver,
  matters,
  leads,
}: {
  threadId: string;
  /** The mailbox this reply sends from — display only. */
  accountEmail: string;
  /** Server-derived defaults for each mode (deriveReplyRecipients). */
  reply: ReplyDefaults;
  replyAll: ReplyDefaults;
  /** Thread has no matter or lead: the reply files it first, so a
   *  record must be chosen (and the viewer must be able to file). */
  needsRecord: boolean;
  /** The thread's matter or lead; null when unfiled. */
  recordScope?: RecordScope | null;
  canFile: boolean;
  /** `documents.upload` - offers "Upload new…" in the attach picker. */
  canUpload?: boolean;
  storageDriver?: StorageDriver;
  matters: FilingMatterOption[];
  leads: FilingLeadOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [editing, setEditing] = useState(false);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  // Editor HTML — survives collapse/mode switches (the editor
  // re-mounts from it) and only resets on a successful send.
  const [body, setBody] = useState(() => getEmailSignature() ?? "");
  const [scope, setScope] = useState<RecordScope | null>(null);
  const [attachments, setAttachments] = useState<AttachableDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const attachScope = needsRecord ? scope : recordScope;
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const defaults = mode === "replyAll" ? replyAll : reply;

  // Reply-all earns its button only when it adds someone.
  const replyAllAddsRecipients =
    replyAll.to.length + replyAll.cc.length >
    reply.to.length + reply.cc.length;

  const openMode = (m: Mode): void => {
    const d = m === "replyAll" ? replyAll : reply;
    setMode(m);
    setToInput(toInputValue(d.to));
    setCcInput(toInputValue(d.cc));
    // Nothing derivable (e.g. a thread of your own sends to
    // yourself) → straight to edit so the user can type a To.
    setEditing(d.to.length === 0);
    setError(null);
    // body intentionally NOT reset — mode switches keep the draft.
  };

  // Empty-document guard ("<p></p>" scaffolding) + the wire's
  // text/plain part in one.
  const bodyText = htmlToText(body);

  const handleSend = (): void => {
    // ALWAYS post the exact recipients the user is looking at: the
    // typed list when editing, else the displayed defaults. The server
    // refuses an unedited send if the thread now derives something
    // different (a sync landed a newer inbound message) instead of
    // silently re-deriving.
    let overrides: {
      to: string[];
      cc: string[];
      recipientsEdited: boolean;
    };
    if (!editing) {
      const shownTo = defaults.to.map((r) => r.email);
      if (shownTo.length === 0) {
        setEditing(true);
        setError("Add at least one recipient.");
        return;
      }
      overrides = {
        to: shownTo,
        cc: defaults.cc.map((r) => r.email),
        recipientsEdited: false,
      };
    } else {
      const toParsed = parseAddressList(toInput);
      if (toParsed.invalid.length > 0) {
        setError(`Invalid address: ${toParsed.invalid.join(", ")}`);
        return;
      }
      if (toParsed.addresses.length === 0) {
        setError("Add at least one recipient.");
        return;
      }
      const ccParsed = parseAddressList(ccInput);
      if (ccParsed.invalid.length > 0) {
        setError(`Invalid Cc address: ${ccParsed.invalid.join(", ")}`);
        return;
      }
      overrides = {
        to: toParsed.addresses,
        cc: ccParsed.addresses,
        recipientsEdited: true,
      };
    }
    if (needsRecord && !scope) {
      setError("Choose a matter or lead.");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const result = await replyToThread(threadId, {
          // Editor HTML goes up as-is — the action sanitizes it
          // (note profile) before it reaches the MIME builder.
          bodyText,
          bodyHtml: body,
          replyAll: mode === "replyAll",
          ...overrides,
          ...(needsRecord && scope ? { scope } : {}),
          attachmentDocumentIds: attachments.map((a) => a.id),
        });
        if (result.ok) {
          if (result.notice) notifySuccess(result.notice);
          setBody(getEmailSignature() ?? "");
          setAttachments([]);
          setMode(null);
          setEditing(false);
          router.refresh();
        } else {
          // Draft (body + any edited recipients) stays put.
          setError(result.error);
          // The thread changed under us - pull the fresh recipients
          // into view so the user can review them before re-sending.
          if (result.code === "recipients_changed") router.refresh();
        }
      } catch {
        // A rejected action must not reach the error boundary (it
        // would discard the draft, and the email may already have
        // gone out - a blind retry would duplicate it).
        setError(SEND_UNCONFIRMED);
      }
    });
  };

  if (mode === null) {
    return (
      <div className="bg-white rounded-lg border border-line px-3 sm:px-4 py-3 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => openMode("reply")}
        >
          <Reply size={12} />
          Reply
        </Button>
        {replyAllAddsRecipients && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => openMode("replyAll")}
          >
            <ReplyAll size={12} />
            Reply all
          </Button>
        )}
        <span className="ml-auto text-2xs font-mono text-ink-4 truncate">
          from {accountEmail}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-line overflow-hidden">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        onKeyDown={blockEnterSubmit}
      >
        <div className="px-3 sm:px-4 py-3 border-b border-line flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {mode === "replyAll" ? (
              <ReplyAll size={13} className="text-ink-3 shrink-0" />
            ) : (
              <Reply size={13} className="text-ink-3 shrink-0" />
            )}
            <span className="text-xs font-medium text-ink">
              {mode === "replyAll" ? "Reply all" : "Reply"}
            </span>
            <span className="text-2xs font-mono text-ink-4 truncate">
              from {accountEmail}
            </span>
            {!editing && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="ml-auto gap-1 text-ink-3"
                onClick={() => setEditing(true)}
              >
                <Pencil size={11} />
                Edit recipients
              </Button>
            )}
          </div>

          {editing ? (
            <div className="flex flex-col gap-2">
              <LabeledField label="To">
                <TextField
                  name="to"
                  value={toInput}
                  onChange={setToInput}
                  placeholder="To — comma-separated addresses"
                  ariaLabel="To"
                />
              </LabeledField>
              <LabeledField label="Cc">
                <TextField
                  name="cc"
                  value={ccInput}
                  onChange={setCcInput}
                  placeholder="Cc (optional)"
                  ariaLabel="Cc"
                />
              </LabeledField>
            </div>
          ) : (
            <div className="text-2xs text-ink-4 flex flex-col gap-0.5">
              <div className="break-all">
                <span>To: </span>
                <span className="font-mono">
                  {defaults.to.map(formatRecipient).join(", ")}
                </span>
              </div>
              {defaults.cc.length > 0 && (
                <div className="break-all">
                  <span>Cc: </span>
                  <span className="font-mono">
                    {defaults.cc.map(formatRecipient).join(", ")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-3 sm:px-4 py-3 flex flex-col gap-2">
          {needsRecord && canFile && (
            <div
              role="group"
              aria-labelledby="reply-record-label"
              className="flex flex-col gap-1"
            >
              <span
                id="reply-record-label"
                className="text-2xs font-medium text-ink-3"
              >
                Matter or lead
              </span>
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
                }}
              />
            </div>
          )}
          {needsRecord && !canFile && (
            <div role="note" className="text-2xs text-ink-3">
              {REPLY_NEEDS_FILER_ERROR}
            </div>
          )}
          <RichTextEditor
            initialHTML={body}
            onChange={setBody}
            placeholder="Write your reply…"
          />
          {!(needsRecord && !canFile) && (
            <SendAttachmentsField
              scope={attachScope}
              value={attachments}
              onChange={setAttachments}
              disabled={isPending}
              canUpload={canUpload}
              storageDriver={storageDriver}
              onBusyChange={setUploading}
            />
          )}
          {error && <div className="text-2xs text-warn">{error}</div>}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              // Collapsing mid-send would hide a failure (the error
              // only renders expanded and openMode clears it).
              disabled={isPending}
              onClick={() => setMode(null)}
            >
              Cancel
            </Button>
            {!(needsRecord && !canFile) && (
              <Button
                type="submit"
                disabled={
                  isPending ||
                  uploading ||
                  !bodyText.trim() ||
                  (needsRecord && !scope)
                }
              >
                {isPending ? "Sending…" : "Send"}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
