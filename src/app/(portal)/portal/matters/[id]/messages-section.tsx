/** "Messages": the client's conversation with the firm, plus a composer. */

import { formatDate } from "@/lib/format-date";
import { PORTAL_TIME_ZONE } from "@/lib/portal/time-zone";
import type { PortalMessageView } from "@/lib/portal/messages";
import { MarkMessagesRead } from "./mark-read";
import { MessageComposer } from "./message-composer";

function closedCopy(phone: string | null, email: string | null): string {
  const contact = [phone, email].filter(Boolean).join(" or ");
  return contact
    ? `This matter is closed. Contact the firm at ${contact}.`
    : "This matter is closed.";
}

export function MessagesSection({
  messages,
  matterId,
  closed,
  firmPhone,
  firmEmail,
}: {
  messages: PortalMessageView[];
  matterId: string;
  closed: boolean;
  firmPhone: string | null;
  firmEmail: string | null;
}) {
  return (
    <section aria-labelledby="messages-heading" className="flex flex-col gap-3">
      <h2 id="messages-heading" className="text-sm font-semibold text-ink-2">
        Messages
      </h2>
      {messages.length > 0 ? (
        <>
          <MarkMessagesRead matterId={matterId} />
          <ul className="flex flex-col gap-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={
                  m.fromClient
                    ? "rounded-xl bg-brand-tint p-4 ring-1 ring-line"
                    : "rounded-xl bg-white p-4 shadow-xs ring-1 ring-line"
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-ink-3">
                  <span className="font-medium text-ink-2">{m.authorLabel}</span>
                  <span>
                    {formatDate(m.createdAt, "full_short", PORTAL_TIME_ZONE)},{" "}
                    {formatDate(m.createdAt, "time", PORTAL_TIME_ZONE)}
                  </span>
                </div>
                <p className="mt-1 text-sm whitespace-pre-line break-words text-ink">{m.body}</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-ink-3">No messages yet. Ask your legal team a question here.</p>
      )}
      {closed ? (
        <p className="text-sm text-ink-3">{closedCopy(firmPhone, firmEmail)}</p>
      ) : (
        <MessageComposer matterId={matterId} />
      )}
    </section>
  );
}
