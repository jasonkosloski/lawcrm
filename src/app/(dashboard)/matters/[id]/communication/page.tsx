/**
 * Matter Detail — Communication tab
 *
 * Three channels, URL-driven (`?channel=email|phone|portal`, ADR-007 style):
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
 *   - **Portal** — the client-portal conversation (portal.view_messages;
 *     without it `?channel=portal` falls back to email).
 */

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { EmbeddedInbox } from "@/components/communication/embedded-inbox";
import { MatterPhoneLog } from "@/components/communication/matter-phone-log";
import { LogCallButton } from "@/components/communication/log-call-button";
import { TextFromTemplateButton } from "@/components/communication/text-from-template-button";
import { PortalConversation } from "@/components/communication/portal-conversation";
import { getPortalConversation } from "@/lib/queries/portal-messages";
import { ComposeEmailLauncher } from "@/components/communication/compose-email-launcher";
import { ChannelToggle } from "@/components/communication/channel-toggle";
import {
  getFilingLeadOptions,
  getFilingMatterOptions,
  getThreadById,
  listThreadsForMatter,
} from "@/lib/queries/communication";
import { listMessengerItemsForMatter } from "@/lib/queries/messenger";
import { listContactPickerOptions } from "@/lib/queries/contacts";
import { currentUserHasPermission } from "@/lib/permission-check";
// Message timestamps are real instants — the embedded reader renders
// them on the viewer's calendar, not the server's (ADR-012).
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { requireUser } from "@/lib/current-user";
import { assertMatterAccess } from "@/lib/matter-access";
import { parsePageParam } from "@/lib/pagination";
import { firstParam } from "@/lib/search-params";

export default async function MatterCommunicationPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/communication">) {
  await requireUser();
  const { id } = await params;
  await assertMatterAccess(id);
  const sp = await searchParams;
  const rawChannel = firstParam(sp.channel);
  // Portal visibility is a permission, so resolve it before choosing
  // the channel: a pasted ?channel=portal without the key becomes email.
  const [canViewPortal, canSendPortal] = await Promise.all([
    currentUserHasPermission("portal.view_messages"),
    currentUserHasPermission("portal.send_messages"),
  ]);
  const channel =
    rawChannel === "phone"
      ? "phone"
      : rawChannel === "portal" && canViewPortal
        ? "portal"
        : "email";
  const rawThread = firstParam(sp.thread);
  const requestedThreadId = typeof rawThread === "string" ? rawThread : null;

  // Every fetch below depends only on the URL (`id` / `?channel` /
  // `?thread`), so run them as a single wave — the reader is
  // URL-driven, meaning this whole page re-runs on every thread
  // click, and a per-stage waterfall multiplies that latency.
  // getThreadById already scopes to the current user's accounts, so
  // it is safe to fetch eagerly here and discard below if the id
  // turns out not to belong to this matter.
  const [
    matter,
    contacts,
    phoneItems,
    threads,
    filingOptions,
    leadOptions,
    requestedThread,
    canEditCall,
    canDeleteCall,
    editMatters,
    tz,
    portalConversation,
  ] = await Promise.all([
    prisma.matter.findUnique({
      where: { id },
      select: { id: true, name: true },
    }),
    // Contact options load only once the log-call gate passes —
    // chained onto the check rather than a separate await stage.
    currentUserHasPermission("communication.log_call").then((canLogCall) =>
      canLogCall ? listContactPickerOptions({ priorityMatterId: id }) : null,
    ),
    channel === "phone" ? listMessengerItemsForMatter(id) : null,
    channel === "email" ? listThreadsForMatter(id, parsePageParam(sp.page)) : null,
    channel === "email" ? getFilingMatterOptions() : null,
    channel === "email" ? getFilingLeadOptions() : null,
    channel === "email" && requestedThreadId ? getThreadById(requestedThreadId) : null,
    currentUserHasPermission("communication.edit_call"),
    currentUserHasPermission("communication.delete_call"),
    // Re-file options for the edit dialog — phone channel only, and
    // only when the edit gate passes (permission checks are
    // per-request cached, so the duplicate check costs nothing).
    channel === "phone"
      ? currentUserHasPermission("communication.edit_call").then((can) =>
          can ? getFilingMatterOptions() : null,
        )
      : null,
    getCurrentUserTimeZone(),
    channel === "portal" ? getPortalConversation(id) : null,
  ]);
  if (!matter) notFound();

  const logCallButton = contacts ? (
    <LogCallButton contacts={contacts} fixedMatter={{ id: matter.id, name: matter.name }} />
  ) : null;

  // Same gate as Log call (`communication.log_call`).
  const textButton = logCallButton ? (
    <TextFromTemplateButton scope={{ kind: "matter", matterId: matter.id }} />
  ) : null;

  if (channel === "portal") {
    return (
      <div className="p-5 flex flex-col flex-1 min-h-0 gap-3">
        <ChannelToggle basePath={`/matters/${id}/communication`} active="portal" showPortal />
        {portalConversation && (
          <PortalConversation
            matterId={id}
            conversation={portalConversation}
            canSend={canSendPortal}
            tz={tz}
          />
        )}
      </div>
    );
  }

  if (channel === "phone") {
    return (
      <div className="p-5 flex flex-col flex-1 min-h-0 gap-3">
        <div className="flex items-center justify-between gap-2">
          <ChannelToggle
            basePath={`/matters/${id}/communication`}
            active="phone"
            showPortal={canViewPortal}
          />
          {logCallButton}
          {textButton}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <MatterPhoneLog
            items={phoneItems ?? []}
            canEditCall={canEditCall}
            canDeleteCall={canDeleteCall}
            matterName={matter.name}
            tz={tz}
            editMatters={(editMatters ?? []).map((m) => ({
              id: m.id,
              name: m.name,
            }))}
          />
        </div>
      </div>
    );
  }

  // Only allow reading threads that are actually on this matter —
  // the eagerly-fetched thread is discarded when a pasted id points
  // at another matter's mail. Checked against the thread's own matter,
  // not the current page, so a thread off this page still opens.
  const threadList = threads?.rows ?? [];
  const selectedThread =
    requestedThread && requestedThread.matter?.id === id ? requestedThread : null;

  return (
    <div className="p-5 flex flex-col flex-1 min-h-0 gap-3">
      <div className="flex items-center justify-between gap-2">
        <ChannelToggle
          basePath={`/matters/${id}/communication`}
          active="email"
          showPortal={canViewPortal}
        />
        <div className="flex items-center gap-2">
          <ComposeEmailLauncher initialScope={{ kind: "matter", matterId: id }} />
          {logCallButton}
          {textButton}
        </div>
      </div>
      <EmbeddedInbox
        threads={threadList}
        selectedThread={selectedThread}
        filingOptions={filingOptions ?? []}
        leadOptions={leadOptions ?? []}
        basePath={`/matters/${id}/communication`}
        emptyLabel="No communication filed to this matter"
        emptyHint="Emails and text messages filed to this matter will appear here. File a thread from the main inbox or let auto-filing catch it."
        showMatterChip={false}
        tz={tz}
        paging={threads ?? undefined}
      />
    </div>
  );
}
