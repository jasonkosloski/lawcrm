/**
 * Matter Detail — Communication tab
 *
 * Two channels, URL-driven (`?channel=email|phone`, ADR-007 style):
 *
 *   - **Email** (default) — mini inbox scoped to this matter: thread
 *     list on the left, reader on the right. Clicking a thread
 *     updates `?thread=<id>` in place; the selected thread is
 *     validated against the matter's thread list so a pasted id
 *     can't read other matters' mail.
 *   - **Phone** — calls / texts / voicemails filed to this matter
 *     (item-level list, newest first), plus the "Log call" composer
 *     with the matter pre-selected and the matter's people floated
 *     to the top of the contact typeahead.
 */

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { EmbeddedInbox } from "@/components/communication/embedded-inbox";
import { MatterPhoneLog } from "@/components/communication/matter-phone-log";
import { LogCallButton } from "@/components/communication/log-call-button";
import { ChannelToggle } from "@/components/communication/channel-toggle";
import {
  getFilingMatterOptions,
  getThreadById,
  listThreadsForMatter,
} from "@/lib/queries/communication";
import { listMessengerItemsForMatter } from "@/lib/queries/messenger";
import { listContactPickerOptions } from "@/lib/queries/contacts";
import { currentUserHasPermission } from "@/lib/permission-check";

export default async function MatterCommunicationPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/communication">) {
  const { id } = await params;
  const sp = await searchParams;
  const rawChannel = Array.isArray(sp.channel) ? sp.channel[0] : sp.channel;
  const channel = rawChannel === "phone" ? "phone" : "email";
  const rawThread = Array.isArray(sp.thread) ? sp.thread[0] : sp.thread;
  const requestedThreadId =
    typeof rawThread === "string" ? rawThread : null;

  const [matter, canLogCall] = await Promise.all([
    prisma.matter.findUnique({
      where: { id },
      select: { id: true, name: true },
    }),
    currentUserHasPermission("communication.log_call"),
  ]);
  if (!matter) notFound();

  const logCallButton = canLogCall ? (
    <LogCallButton
      contacts={await listContactPickerOptions({ priorityMatterId: id })}
      fixedMatter={{ id: matter.id, name: matter.name }}
    />
  ) : null;

  if (channel === "phone") {
    const items = await listMessengerItemsForMatter(id);
    return (
      <div className="p-5 flex flex-col flex-1 min-h-0 gap-3">
        <div className="flex items-center justify-between gap-2">
          <ChannelToggle basePath={`/matters/${id}/communication`} active="phone" />
          {logCallButton}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <MatterPhoneLog items={items} />
        </div>
      </div>
    );
  }

  const [threads, filingOptions] = await Promise.all([
    listThreadsForMatter(id),
    getFilingMatterOptions(),
  ]);

  // Only allow reading threads that are actually on this matter.
  const threadId =
    requestedThreadId && threads.some((t) => t.id === requestedThreadId)
      ? requestedThreadId
      : null;

  const selectedThread = threadId ? await getThreadById(threadId) : null;

  return (
    <div className="p-5 flex flex-col flex-1 min-h-0 gap-3">
      <div className="flex items-center justify-between gap-2">
        <ChannelToggle basePath={`/matters/${id}/communication`} active="email" />
        {logCallButton}
      </div>
      <EmbeddedInbox
        threads={threads}
        selectedThread={selectedThread}
        filingOptions={filingOptions}
        basePath={`/matters/${id}/communication`}
        emptyLabel="No communication filed to this matter"
        emptyHint="Emails and text messages filed to this matter will appear here. File a thread from the main inbox or let auto-filing catch it."
        showMatterChip={false}
      />
    </div>
  );
}
