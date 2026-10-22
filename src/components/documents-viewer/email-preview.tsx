/**
 * Email file (.eml / .msg) preview — headers, body, attachment list.
 * Server-rendered from `renderStoredEmail`. The HTML body was run
 * through `sanitizeEmailHtml` (the hostile-mail profile: no scripts,
 * no forms, remote tracking images replaced with a placeholder) and
 * reuses the thread reader's `email-body` styles. Text is real DOM
 * text, so TextReview's quote flags work on it.
 *
 * Attachment chips open the attachment's own document once the email's
 * attachments have been extracted (ADR-043) — `attachmentDocIds[i]` is
 * the document made from attachment i. Before that they're plain
 * labels, and `headerAction` carries the "Add attachments" button.
 */

import { scopeBasePath, type RecordScope } from "@/lib/record-scope";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import type { EmailPreview as EmailData } from "@/lib/office-preview";
import { formatDate } from "@/lib/format-date";
import { formatFileSize } from "@/lib/document-display";

export function EmailPreview({
  email,
  tz,
  scope,
  attachmentDocIds = {},
  headerAction,
}: {
  email: EmailData;
  tz: string;
  scope?: RecordScope;
  /** Attachment index → the document extracted from it. */
  attachmentDocIds?: Record<number, string>;
  headerAction?: React.ReactNode;
}) {
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
            {email.attachments.map((a, i) => {
              const docId = attachmentDocIds[i];
              const body = (
                <>
                  <Paperclip className="h-3 w-3" aria-hidden />
                  {a.name}
                  {a.size !== null && (
                    <span className="text-ink-4">· {formatFileSize(a.size)}</span>
                  )}
                </>
              );
              return (
                <li key={i}>
                  {docId && scope ? (
                    <Link
                      href={`${scopeBasePath(scope)}/documents/${docId}`}
                      title={`Open ${a.name}`}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-0.5 text-2xs text-brand-700 hover:border-brand-300 hover:underline"
                    >
                      {body}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-0.5 text-2xs text-ink-3">
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {headerAction && <div className="mt-2">{headerAction}</div>}
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
