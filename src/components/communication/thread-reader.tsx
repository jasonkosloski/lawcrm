/**
 * Thread Reader
 *
 * Right pane. Renders a stack of messages in the selected thread with
 * email-style chrome: subject at top, then each message as a card with
 * sender / recipients / timestamp / body / attachments.
 *
 * Body uses Fraunces display font (matches the design spec for email
 * body typography in UI_PATTERNS).
 */

import Link from "next/link";
import { format } from "date-fns";
import { MailOpen, Paperclip, Reply, ShieldCheck } from "lucide-react";
import type { ThreadDetail } from "@/lib/queries/communication";
import { InboxActionButtons } from "./inbox-action-buttons";
import { FollowUpButton } from "./follow-up-button";
import { setEmailThreadFollowUp } from "@/app/actions/follow-ups";
import { LogTimeOnCommButton } from "./log-time-on-comm-button";

const formatSize = (bytes: number | null): string => {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatRecipients = (
  list: Array<{ name?: string; email: string }>
): string =>
  list.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email)).join(", ");

export function ThreadReader({ thread }: { thread: ThreadDetail | null }) {
  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center bg-paper-email min-h-0">
        <div className="flex flex-col items-center gap-2 text-ink-4 text-xs">
          <MailOpen size={24} />
          Select a thread to read
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper-email overflow-y-auto">
      {/* Subject header */}
      <header className="sticky top-0 z-10 bg-paper-email/95 backdrop-blur-sm px-6 py-4 border-b border-line">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-xl font-medium tracking-tight text-ink leading-snug">
              {thread.subject}
            </h1>
            <div className="flex items-center gap-2 mt-1.5 text-2xs">
              {thread.matter ? (
                <Link
                  href={`/matters/${thread.matter.id}`}
                  className="inline-flex items-center gap-1.5 font-mono text-ink-3 hover:text-brand-700"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: thread.matter.color }}
                  />
                  {thread.matter.name} · {thread.matter.area}
                </Link>
              ) : (
                <span className="font-medium text-warn">Unfiled</span>
              )}
              <span className="text-ink-4">·</span>
              <span className="font-mono text-ink-4">
                {thread.messageCount}{" "}
                {thread.messageCount === 1 ? "message" : "messages"}
              </span>
              {thread.labels.length > 0 && (
                <>
                  <span className="text-ink-4">·</span>
                  <span className="flex items-center gap-1">
                    {thread.labels.map((l) => (
                      <span
                        key={l}
                        className="text-2xs font-mono text-ink-3 bg-white px-1.5 py-px rounded border border-line"
                      >
                        {l.replace("_", " ")}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <FollowUpButton
              threadId={thread.id}
              followUpAt={thread.followUpAt}
              action={setEmailThreadFollowUp}
            />
            {/* Inbox-to-action shortcuts. Disabled when the thread is
                unfiled — actions need a matter to attach the new entity to. */}
            <InboxActionButtons
              isFiled={thread.matter !== null}
              source={{
                kind: "email",
                id: thread.id,
                subject: thread.subject,
                // Quote the first message in the prefilled note body —
                // gives the user a starting block of context to edit
                // down. 400 chars keeps the dialog from being a wall of
                // text on long emails.
                snippet: thread.messages[0]?.body?.slice(0, 400) ?? "",
              }}
            />
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 px-6 py-5 flex flex-col gap-4">
        {thread.messages.map((m) => (
          <article
            key={m.id}
            className="bg-white rounded-lg border border-line overflow-hidden"
          >
            <header className="flex items-start gap-3 px-4 py-3 border-b border-line">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink">
                    {m.fromName}
                  </span>
                  <span className="text-2xs font-mono text-ink-4">
                    &lt;{m.fromEmail}&gt;
                  </span>
                  {m.isPrivileged && (
                    <span
                      className="inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded-full border bg-warn-soft text-warn border-warn-border"
                      title="Flagged as attorney-client privileged"
                    >
                      <ShieldCheck size={10} />
                      Privileged
                    </span>
                  )}
                </div>
                <div className="text-2xs text-ink-4 mt-0.5">
                  <span>To: </span>
                  <span className="font-mono">
                    {formatRecipients(m.toRecipients)}
                  </span>
                  {m.ccRecipients.length > 0 && (
                    <>
                      <span className="ml-2">Cc: </span>
                      <span className="font-mono">
                        {formatRecipients(m.ccRecipients)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <div className="text-2xs font-mono text-ink-4 whitespace-nowrap">
                  {format(m.sentAt, "MMM d, yyyy · h:mm a")}
                </div>
                <LogTimeOnCommButton
                  isFiled={thread.matter !== null}
                  source={{
                    kind: "email",
                    messageId: m.id,
                    label: `${m.fromName}: ${thread.subject}`,
                  }}
                />
              </div>
            </header>

            {/* Body — uses the email-body class from globals.css (Fraunces,
                13.5px, line-height 1.62 per UI_PATTERNS). */}
            <div className="email-body px-4 py-4 text-ink">{m.body}</div>

            {/* Attachments */}
            {m.attachments.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-line bg-paper-2/40">
                {m.attachments.map((a) => (
                  <div
                    key={a.id}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-line bg-white text-2xs text-ink-2"
                    title={`${a.filename} — ${formatSize(a.fileSize)}`}
                  >
                    <Paperclip size={11} className="text-ink-4" />
                    <span className="font-medium truncate max-w-48">
                      {a.filename}
                    </span>
                    <span className="font-mono text-ink-4">
                      {formatSize(a.fileSize)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}

        {/* Reply stub — disabled placeholder */}
        <div className="bg-white rounded-lg border border-dashed border-line px-4 py-5 flex items-center gap-2 text-xs text-ink-4">
          <Reply size={13} />
          <span>
            Reply, forward, and file-to-matter actions land in a follow-up
            pass.
          </span>
        </div>
      </div>
    </div>
  );
}
