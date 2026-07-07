/**
 * Lead Detail — Communication tab
 *
 * Mini inbox scoped to this lead, driven by the lead's joined Contact:
 *   - Email threads matching `displayEmail` (sender / recipient / cc)
 *   - SMS / call / voicemail threads on `displayPhone`
 *
 * Either side renders only when the corresponding contact channel is
 * known. Empty state covers the genuinely-no-contact case (no email
 * AND no phone). Clicking an email thread updates `?thread=<id>` in
 * place; SMS rows link out to the main `/communication?view=messages`
 * page since there's no embedded messenger reader today.
 *
 * "Log call" (gated on `communication.log_call`) opens the manual
 * call composer with the lead's contact pre-selected — mirrors the
 * matter Communication tab, except lead calls file to no matter
 * (there isn't one yet; conversion is what creates it).
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmailLink } from "@/components/ui/email-link";
import { EmbeddedInbox } from "@/components/communication/embedded-inbox";
import {
  getFilingMatterOptions,
  getThreadById,
  listThreadsForEmail,
} from "@/lib/queries/communication";
import {
  listMessengerThreadsForPhone,
  type MessengerThreadRow,
} from "@/lib/queries/messenger";
// Thread timestamps are real instants — render them on the viewer's
// calendar via the centralized formatter + user TZ (ADR-012).
import { formatDate } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatPhone } from "@/lib/format-phone";
import { getLeadById } from "@/lib/queries/leads";
import { listContactPickerOptions } from "@/lib/queries/contacts";
import { currentUserHasPermission } from "@/lib/permission-check";
import { LogCallButton } from "@/components/communication/log-call-button";

export default async function LeadCommunicationPage({
  params,
  searchParams,
}: PageProps<"/intake/[id]/communication">) {
  const { id } = await params;
  const sp = await searchParams;
  const rawThread = Array.isArray(sp.thread) ? sp.thread[0] : sp.thread;
  const requestedThreadId =
    typeof rawThread === "string" ? rawThread : null;

  const lead = await getLeadById(id);
  if (!lead) notFound();

  const email = lead.displayEmail;
  const phone = lead.displayPhone;

  // Email + SMS in parallel; either may be empty depending on what
  // contact channels we know about.
  const [emailThreads, messengerThreads, filingOptions, callContacts, tz] =
    await Promise.all([
      email ? listThreadsForEmail(email) : Promise.resolve([]),
      phone ? listMessengerThreadsForPhone(phone) : Promise.resolve([]),
      getFilingMatterOptions(),
      // Contact typeahead options for the log-call composer — only
      // when the gate passes AND the lead has a joined contact to
      // pre-select (leads always do post-migration, but stay safe).
      currentUserHasPermission("communication.log_call").then((can) =>
        can && lead.contact ? listContactPickerOptions() : null
      ),
      getCurrentUserTimeZone(),
    ]);

  // "Log call" prefilled with the lead's contact. No matter picker
  // options: a lead has no matter until conversion, so lead calls
  // file as "No matter (general)" and live on the contact's thread.
  const leadContact = lead.contact;
  const logCallButton =
    callContacts && leadContact ? (
      <LogCallButton
        contacts={callContacts}
        fixedContact={{
          id: leadContact.id,
          name: leadContact.name,
          organization: leadContact.organization,
          phone: leadContact.phone ?? leadContact.phones[0]?.number ?? null,
        }}
      />
    ) : null;

  // Only allow reading email threads that are actually in the lead's set.
  const threadId =
    requestedThreadId && emailThreads.some((t) => t.id === requestedThreadId)
      ? requestedThreadId
      : null;

  const selectedThread = threadId ? await getThreadById(threadId) : null;

  // Truly no contact info — show a single empty card. The composer
  // stays available (it accepts a typed phone number) so the first
  // call can still be captured.
  if (!email && !phone) {
    return (
      <div className="p-5">
        <div className="max-w-4xl flex flex-col gap-3">
          {logCallButton && (
            <div className="flex items-center justify-end">
              {logCallButton}
            </div>
          )}
          <Card>
            <div className="p-5 text-xs text-ink-3">
              This lead has no email or phone on file yet, so there&apos;s
              nothing to match threads against. Add contact info on the
              Overview tab to start surfacing communication.
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col flex-1 min-h-0 gap-4">
      {logCallButton && (
        <div className="flex items-center justify-end shrink-0">
          {logCallButton}
        </div>
      )}
      {email ? (
        <div className="flex flex-col flex-1 min-h-0 gap-3">
          <div className="text-2xs font-mono text-ink-4 shrink-0">
            Email threads where{" "}
            <EmailLink
              email={email}
              className="text-ink-3 hover:text-brand-700 hover:underline"
            />{" "}
            is the sender, recipient, or cc.
          </div>
          <EmbeddedInbox
            threads={emailThreads}
            selectedThread={selectedThread}
            filingOptions={filingOptions}
            basePath={`/intake/${id}/communication`}
            emptyLabel="No emails yet"
            emptyHint={`Emails to or from ${email} will surface here.`}
            tz={tz}
          />
        </div>
      ) : (
        <Card>
          <div className="p-4 text-xs text-ink-3">
            No email on file — capture one on the Overview tab to start
            tracking email threads here.
          </div>
        </Card>
      )}

      {phone && (
        <SmsSection
          phone={phone}
          threads={messengerThreads}
          tz={tz}
        />
      )}
    </div>
  );
}

/** SMS / call / voicemail history for the lead's phone number. Each
 *  row links out to the main /communication?view=messages reader
 *  since the lead-tab inbox is email-only. Renders nothing-but-a-
 *  hint when the contact has no messenger history yet. */
function SmsSection({
  phone,
  threads,
  tz,
}: {
  phone: string;
  threads: MessengerThreadRow[];
  /** Viewer's IANA zone — lastAt is a real instant. */
  tz: string;
}) {
  return (
    <div className="flex flex-col gap-2 shrink-0">
      <div className="text-2xs font-mono text-ink-4">
        SMS / calls on{" "}
        <span className="text-ink-3">{formatPhone(phone)}</span>
      </div>
      <Card className="p-0 overflow-hidden">
        {threads.length === 0 ? (
          <div className="p-4 text-xs text-ink-3 flex items-center gap-2">
            <MessageCircle size={13} className="text-ink-4" />
            No texts or calls with {formatPhone(phone)} yet.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {threads.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/communication?view=messages&thread=${t.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-paper-2 transition-colors"
                >
                  <MessageCircle size={13} className="text-ink-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-ink truncate">
                      {t.lastBody ?? `${t.lastKind ?? "Conversation"}`}
                    </div>
                    {t.defaultMatterName && (
                      <div className="text-2xs text-ink-4 truncate">
                        Filed to {t.defaultMatterName}
                      </div>
                    )}
                  </div>
                  {t.unreadCount > 0 && (
                    <span className="text-2xs font-mono font-medium px-1.5 py-px rounded-lg bg-brand-50 text-brand-700 border border-brand-100 shrink-0">
                      {t.unreadCount}
                    </span>
                  )}
                  <span className="text-2xs font-mono text-ink-4 shrink-0">
                    {formatDate(t.lastAt, "short", tz)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
