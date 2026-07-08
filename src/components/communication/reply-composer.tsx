/**
 * Reply composer — the interactive island at the bottom of the email
 * thread reader (both the full /communication reader and the
 * embedded matter/intake reader mount it via ReplySection).
 *
 * Collapsed: "Reply" / "Reply all" affordances (Reply all only when
 * it would actually add recipients). Expanded: server-derived
 * recipients shown read-only with an Edit toggle (comma-separated,
 * client-validated), plain-text body, Send with pending state.
 *
 * Draft contract: the body survives mode switches, collapse, and —
 * critically — send failures; it only clears after a successful
 * send, which then router.refresh()es so the locally-upserted sent
 * message appears in the thread.
 *
 * Recipient honesty: when the user does NOT edit, we send only
 * `replyAll` and let the action re-derive server-side (the displayed
 * defaults come from the same tested helper). Edited recipients go
 * up as explicit overrides.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Reply, ReplyAll } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import { parseAddressList, plainTextToHtml } from "@/lib/google/mime";
import { replyToThread } from "@/app/actions/email-send";

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
}: {
  threadId: string;
  /** The mailbox this reply sends from — display only. */
  accountEmail: string;
  /** Server-derived defaults for each mode (deriveReplyRecipients). */
  reply: ReplyDefaults;
  replyAll: ReplyDefaults;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [editing, setEditing] = useState(false);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [body, setBody] = useState("");
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

  const handleSend = (): void => {
    let overrides: { to?: string[]; cc?: string[] } = {};
    if (editing) {
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
      overrides = { to: toParsed.addresses, cc: ccParsed.addresses };
    }
    setError(null);

    startTransition(async () => {
      const result = await replyToThread(threadId, {
        bodyText: body,
        bodyHtml: plainTextToHtml(body),
        replyAll: mode === "replyAll",
        ...overrides,
      });
      if (result.ok) {
        setBody("");
        setMode(null);
        setEditing(false);
        router.refresh();
      } else {
        // Draft (body + any edited recipients) stays put.
        setError(result.error);
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
              <TextField
                name="to"
                value={toInput}
                onChange={setToInput}
                placeholder="To — comma-separated addresses"
              />
              <TextField
                name="cc"
                value={ccInput}
                onChange={setCcInput}
                placeholder="Cc (optional)"
              />
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
          <TextareaField
            name="body"
            value={body}
            onChange={setBody}
            placeholder="Write your reply…"
            rows={5}
          />
          {error && <div className="text-2xs text-warn">{error}</div>}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !body.trim()}>
              {isPending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
