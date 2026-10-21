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
 * `htmlToText` downgrade as `bodyText`. Attachments + per-user
 * signatures are documented follow-ups in FEATURES —
 * `getEmailSignature()` is the seam for the latter.
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
import { getEmailSignature } from "@/lib/email-signature";
import { sendEmail } from "@/app/actions/email-send";
import { blockEnterSubmit, LabeledField } from "./labeled-field";

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
}: {
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
  const [body, setBody] = useState(() => getEmailSignature() ?? "");
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
    setBody(getEmailSignature() ?? "");
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
        });
        if (result.ok) {
          resetDraft();
          setOpen(false);
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
              . Attachments are on the way.
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
                disabled={isPending || !to.trim() || !bodyText.trim()}
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
