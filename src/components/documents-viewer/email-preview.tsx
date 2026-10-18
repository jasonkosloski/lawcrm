/**
 * Email file (.eml / .msg) preview — headers, body, attachment list.
 * Server-rendered from `renderStoredEmail`. The HTML body was run
 * through `sanitizeEmailHtml` (the hostile-mail profile: no scripts,
 * no forms, remote tracking images replaced with a placeholder) and
 * reuses the thread reader's `email-body` styles. Text is real DOM
 * text, so TextReview's quote flags work on it.
 *
 * Attachments are listed by name and size only; opening one means
 * downloading the email and opening it in a mail client (follow-up:
 * extract attachments into the matter's documents).
 */

import { Paperclip } from "lucide-react";
import type { EmailPreview as EmailData } from "@/lib/office-preview";
import { formatDate } from "@/lib/format-date";
import { formatFileSize } from "@/lib/document-display";

export function EmailPreview({ email, tz }: { email: EmailData; tz: string }) {
  const rows: [string, string][] = [
    ["From", email.from],
    ["To", email.to.join(", ")],
  ];
  if (email.cc.length) rows.push(["Cc", email.cc.join(", ")]);
  if (email.date) rows.push(["Date", formatDate(new Date(email.date), "datetime_long", tz)]);

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-auto rounded-lg border border-line bg-white">
      <div className="border-b border-line bg-paper-2 px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">{email.subject}</h3>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-4">{k}</dt>
              <dd className="min-w-0 break-words text-ink-2">{v || "—"}</dd>
            </div>
          ))}
        </dl>
        {email.attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Attachments">
            {email.attachments.map((a, i) => (
              <li
                key={i}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-0.5 text-2xs text-ink-3"
              >
                <Paperclip className="h-3 w-3" aria-hidden />
                {a.name}
                {a.size !== null && <span className="text-ink-4">· {formatFileSize(a.size)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {email.html ? (
        <div
          className="email-body email-body-html px-4 py-4 text-ink break-words"
          dangerouslySetInnerHTML={{ __html: email.html }}
        />
      ) : (
        <div className="email-body whitespace-pre-wrap px-4 py-4 text-ink break-words">
          {email.text || "(no message body)"}
        </div>
      )}
    </div>
  );
}
