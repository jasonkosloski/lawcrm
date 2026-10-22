/**
 * Lead Detail — Communication tab
 *
 * Mini inbox scoped to this lead:
 *   - Email threads filed to the lead (listThreadsForLead, the
 *     viewer's own mailbox). Always rendered; it does not depend on
 *     the contact having an email address.
 *   - SMS / call / voicemail threads on `displayPhone`, rendered when
 *     the contact has a phone. SMS / calls match by the contact record
 *     (calls logged from this tab file to the contact whatever number
 *     was typed) or any of the contact's known numbers.
 *
 * Clicking an email thread updates `?thread=<id>` in place; the
 * selected thread is validated against the lead it is filed to, so a
 * pasted id can't read other records' mail. SMS rows link out to the
 * main `/communication?view=messages` page since there's no embedded
 * messenger reader today.
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
import { EmbeddedInbox } from "@/components/communication/embedded-inbox";
import {
  getFilingLeadOptions,
  getFilingMatterOptions,
  getThreadById,
  listThreadsForLead,
} from "@/lib/queries/communication";
import { listMessengerThreadsForLead, type MessengerThreadRow } from "@/lib/queries/messenger";
// Thread timestamps are real instants — render them on the viewer's
// calendar via the centralized formatter + user TZ (ADR-012).
import { formatDate } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatPhone } from "@/lib/format-phone";
import { getLeadById } from "@/lib/queries/leads";
import { listContactPickerOptions } from "@/lib/queries/contacts";
import { currentUserHasPermission } from "@/lib/permission-check";
import { ComposeEmailLauncher } from "@/components/communication/compose-email-launcher";
import { LogCallButton } from "@/components/communication/log-call-button";
import { requireUser } from "@/lib/current-user";
import { assertLeadAccess } from "@/lib/lead-access";
import { parsePageParam } from "@/lib/pagination";
import { firstParam } from "@/lib/search-params";

export default async function LeadCommunicationPage({
  params,
  searchParams,
}: PageProps<"/intake/[id]/communication">) {
  await requireUser();
  const { id } = await params;
  await assertLeadAccess(id);
  const sp = await searchParams;
  const rawThread = firstParam(sp.thread);
  const requestedThreadId = typeof rawThread === "string" ? rawThread : null;

  const lead = await getLeadById(id);
  if (!lead) notFound();

  const phone = lead.displayPhone;

  // Filed email + SMS + the (eager) requested thread in one wave; the
  // thread is discarded below if it isn't filed to this lead.
  const [emailThreads, requestedThread, messengerThreads, callContacts, tz] = await Promise.all([
    listThreadsForLead(id, parsePageParam(sp.page)),
    requestedThreadId ? getThreadById(requestedThreadId) : null,
    phone
      ? listMessengerThreadsForLead({
          contactId: lead.contact?.id,
          phones: [
            phone,
            lead.contact?.phone,
            ...(lead.contact?.phones.map((p) => p.number) ?? []),
          ],
        })
      : Promise.resolve([]),
    // Contact typeahead options for the log-call composer — only
    // when the gate passes AND the lead has a joined contact to
    // pre-select (leads always do post-migration, but stay safe).
    currentUserHasPermission("communication.log_call").then((can) =>
      can && lead.contact ? listContactPickerOptions() : null,
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

  // Compose prefilled with this lead; a converted lead's mail lives
  // on its matter now, so it can't be a filing target.
  const composeButton =
    lead.stage === "converted" ? null : (
      <ComposeEmailLauncher initialScope={{ kind: "lead", leadId: id }} />
    );

  // Only the lead's own filed threads may open in the reader.
  const selectedThread =
    requestedThread && requestedThread.lead?.id === id ? requestedThread : null;

  // The filing options only feed the open thread's reader, so skip
  // those (unbounded) queries until a thread is selected.
  const [filingOptions, leadOptions] = selectedThread
    ? await Promise.all([getFilingMatterOptions(), getFilingLeadOptions()])
    : [[], []];

  return (
    <div className="p-5 flex flex-col flex-1 min-h-0 gap-4">
      {(logCallButton || composeButton) && (
        <div className="flex items-center justify-end gap-2 shrink-0">
          {composeButton}
          {logCallButton}
        </div>
      )}
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        <EmbeddedInbox
          threads={emailThreads.rows}
          selectedThread={selectedThread}
          filingOptions={filingOptions}
          leadOptions={leadOptions}
          basePath={`/intake/${id}/communication`}
          emptyLabel="No emails filed to this lead yet"
          emptyHint="Emails filed to this lead will appear here."
          showMatterChip={false}
          tz={tz}
          paging={emailThreads}
        />
      </div>

      {phone && <SmsSection phone={phone} threads={messengerThreads} tz={tz} />}
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
        SMS / calls with this contact · <span className="text-ink-3">{formatPhone(phone)}</span>
      </div>
      <Card className="p-0 overflow-hidden">
        {threads.length === 0 ? (
          <div className="p-4 text-xs text-ink-3 flex items-center gap-2">
            <MessageCircle size={13} className="text-ink-4" />
            No texts or calls with this contact yet.
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
