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
import { MailOpen, Paperclip, ShieldCheck } from "lucide-react";
// sentAt is a real instant — server-rendered, so display threads the
// viewer's IANA zone (ADR-012). "datetime_medium" is the centralized
// spelling of the "MMM d, yyyy, h:mm a" this header always used.
import { formatDate } from "@/lib/format-date";
import { formatEmailLabel } from "@/lib/format-label";
import { plural } from "@/lib/utils";
import type { ThreadDetail } from "@/lib/queries/communication";
import { InboxActionButtons } from "./inbox-action-buttons";
import { FollowUpButton } from "./follow-up-button";
import { setEmailThreadFollowUp } from "@/app/actions/follow-ups";
import { LogTimeOnCommButton } from "./log-time-on-comm-button";
import { CommTimeLoggedIndicator } from "./comm-time-logged-indicator";
import { FileToMatterPicker } from "./file-to-matter-picker";
import { BackToListButton } from "./back-to-list-button";
import { MarkThreadRead } from "./mark-thread-read";
import { ReplySection } from "./reply-section";
import { isHtmlEmailBody } from "@/lib/email-body";
import type { FilingMatterOption } from "@/lib/queries/communication";

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

export function ThreadReader({
  thread,
  /** Open-matter list passed in from the page server component so the
   *  file-to-matter picker can render synchronously. */
  filingOptions,
  tz = null,
}: {
  thread: ThreadDetail | null;
  filingOptions: FilingMatterOption[];
  /** Viewer's IANA zone — message timestamps are real instants. */
  tz?: string | null;
}) {
  if (!thread) {
    // Empty-state placeholder — only useful on lg+ where the list
    // is visible alongside. On mobile the thread list IS the home
    // view; the placeholder would just take up screen space, so
    // hide it.
    return (
      <div className="hidden lg:flex flex-1 items-center justify-center bg-paper-email min-h-0">
        <div className="flex flex-col items-center gap-2 text-ink-4 text-xs">
          <MailOpen size={24} />
          Select a thread to read
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper-email overflow-y-auto">
      {/* Opening the reader marks the thread read (idempotent island,
          renders nothing). */}
      <MarkThreadRead channel="email" threadId={thread.id} />
      {/* Subject header */}
      <header className="sticky top-0 z-10 bg-paper-email/95 backdrop-blur-sm px-4 sm:px-6 py-3 sm:py-4 border-b border-line">
        {/* Subject + back button — always at the top so it doesn't
            compete with action buttons for horizontal space. */}
        <div className="min-w-0">
          <BackToListButton />
          <h1 className="font-display text-lg sm:text-xl font-medium tracking-tight text-ink leading-snug break-words">
            {thread.subject}
          </h1>
        </div>

        {/* Meta row + action row.
            - Meta (file-to-matter picker, message count, labels) wraps
              freely on small screens.
            - Action buttons (follow-up + inbox shortcuts) sit BELOW the
              meta on `<sm` so they're full-width tap targets, and
              FLOAT to the right alongside the meta on sm+. */}
        <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap text-2xs min-w-0">
            <FileToMatterPicker
              threadId={thread.id}
              currentMatter={thread.matter}
              options={filingOptions}
            />
            <span className="text-ink-4">·</span>
            <span className="font-mono text-ink-4">
              {plural(thread.messageCount, "message")}
            </span>
            {thread.labels.length > 0 && (
              <>
                <span className="text-ink-4">·</span>
                <span className="flex items-center gap-1 flex-wrap">
                  {thread.labels.map((l) => (
                    <span
                      key={l}
                      className="text-2xs text-ink-3 bg-white px-1.5 py-px rounded border border-line"
                    >
                      {formatEmailLabel(l)}
                    </span>
                  ))}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
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
      <div className="flex-1 px-3 sm:px-6 py-4 sm:py-5 flex flex-col gap-3 sm:gap-4">
        {thread.messages.map((m) => (
          <article
            key={m.id}
            className="bg-white rounded-lg border border-line overflow-hidden"
          >
            {/* Per-message header. On `<sm` it stacks: sender row,
                then recipients row, then timestamp + log-time row at
                the bottom. On sm+ the timestamp + actions float to
                the right of the sender column. */}
            <header className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 px-3 sm:px-4 py-3 border-b border-line">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink truncate">
                    {m.fromName}
                  </span>
                  <span className="text-2xs font-mono text-ink-4 truncate">
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
                {/* Recipients block. Each line breaks on sm+ so the
                    cursor can rest on the labels; on `<sm` they wrap
                    naturally. The `break-all` on the recipient list
                    prevents very long single-token emails from
                    pushing the layout horizontal. */}
                <div className="text-2xs text-ink-4 mt-0.5 flex flex-col gap-0.5">
                  <div className="break-all">
                    <span>To: </span>
                    <span className="font-mono">
                      {formatRecipients(m.toRecipients)}
                    </span>
                  </div>
                  {m.ccRecipients.length > 0 && (
                    <div className="break-all">
                      <span>Cc: </span>
                      <span className="font-mono">
                        {formatRecipients(m.ccRecipients)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-1.5 shrink-0">
                <div className="text-2xs font-mono text-ink-4 whitespace-nowrap">
                  {formatDate(m.sentAt, "datetime_medium", tz)}
                </div>
                <div className="flex items-center gap-1.5">
                  <CommTimeLoggedIndicator
                    entries={m.timeEntries}
                    align="right"
                  />
                  <LogTimeOnCommButton
                    isFiled={thread.matter !== null}
                    source={{
                      kind: "email",
                      messageId: m.id,
                      label: `${m.fromName}: ${thread.subject}`,
                    }}
                  />
                </div>
              </div>
            </header>

            {/* Body — uses the email-body class from globals.css (Fraunces,
                13.5px, line-height 1.62 per UI_PATTERNS). Slightly tighter
                horizontal padding on phones to maximize reading width.
                Two body shapes coexist: Gmail-synced (and CRM-sent)
                messages store sanitized HTML — nothing unsanitized ever
                reaches EmailMessage.body (sanitizeEmailHtml at the sync/
                send write boundary), so dangerouslySetInnerHTML is safe
                here. Legacy/seeded bodies are plain text and keep the
                pre-wrap text path (rendering them as HTML would collapse
                their newlines). */}
            {isHtmlEmailBody(m.body) ? (
              <div
                className="email-body email-body-html px-3 sm:px-4 py-4 text-ink break-words"
                dangerouslySetInnerHTML={{ __html: m.body }}
              />
            ) : (
              <div className="email-body px-3 sm:px-4 py-4 text-ink break-words">
                {m.body}
              </div>
            )}

            {/* Attachments */}
            {m.attachments.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-t border-line bg-paper-2/40">
                {m.attachments.map((a) => (
                  <div
                    key={a.id}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-line bg-white text-2xs text-ink-2 max-w-full"
                    title={`${a.filename} — ${formatSize(a.fileSize)}`}
                  >
                    <Paperclip size={11} className="text-ink-4 shrink-0" />
                    <span className="font-medium truncate max-w-48">
                      {a.filename}
                    </span>
                    <span className="font-mono text-ink-4 shrink-0">
                      {formatSize(a.fileSize)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}

        {/* Reply / Reply all — self-fetching server island (permission
            + account state + derived recipients), so the embedded
            matter/intake readers get it without new page props. */}
        <ReplySection thread={thread} />
      </div>
    </div>
  );
}
