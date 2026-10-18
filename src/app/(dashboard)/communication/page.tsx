/**
 * Communication Page
 *
 * Unified inbox surface for the firm. Two views switched by URL:
 *   ?view=email     → email three-pane (existing)
 *   ?view=messages  → messenger three-pane (SMS + calls + voicemails)
 *
 * Both views share the same TopBar with a tab strip beneath it. URL
 * also carries the in-view filter (`?filter=…`) and the open thread
 * (`?thread=…`); each view has its own ID space, so tab switches drop
 * the thread param.
 *
 * The email view reads the viewer's own synced Gmail mailbox (reply,
 * file-to-matter, follow-ups and time logging live in the reader); the
 * messages view lists SMS / calls / voicemails and hosts the manual
 * "Log a call" composer. Each view fetches full counts only for its own
 * rail and a single cheap unread count for the other tab's badge.
 */

import { after } from "next/server";
import { TopBar } from "@/components/layout/topbar";
import { CommunicationTabs } from "@/components/communication/communication-tabs";
import { MailboxRail } from "@/components/communication/mailbox-rail";
import { ThreadList } from "@/components/communication/thread-list";
import { ThreadReader } from "@/components/communication/thread-reader";
import { MessengerMailboxRail, type MessengerFilter } from "@/components/communication/messenger-mailbox-rail";
import { MessengerThreadList } from "@/components/communication/messenger-thread-list";
import { MessengerThreadReader } from "@/components/communication/messenger-thread-reader";
import {
  MailboxDrawer,
  MailboxDrawerProvider,
} from "@/components/communication/mailbox-drawer";
import {
  defaultEmailFilter,
  getCommunicationCounts,
  getCommunicationPinnedMatters,
  getEmailUnreadCount,
  getFilingMatterOptions,
  getThreadById,
  listThreads,
  type CommunicationFilter,
} from "@/lib/queries/communication";
import {
  getMessengerMailboxCounts,
  getMessengerThread,
  getMessengerUnreadCount,
  listMessengerThreads,
} from "@/lib/queries/messenger";
import { listContactPickerOptions } from "@/lib/queries/contacts";
import { currentUserHasPermission } from "@/lib/permission-check";
// Message timestamps are real instants — the lists + readers render
// them on the viewer's calendar, not the server's (ADR-012).
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { LogCallButton } from "@/components/communication/log-call-button";
import { getCurrentUserId, requireUser } from "@/lib/current-user";
import { maybeKickEmailSync } from "@/lib/google/gmail-sync";
import { SyncNowButton } from "@/components/communication/sync-now-button";
import { parsePageParam } from "@/lib/pagination";

type View = "email" | "messages";

function parseView(raw: string | string[] | undefined): View {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "messages" ? "messages" : "email";
}

function parseEmailFilter(
  raw: string | string[] | undefined,
  fallback: CommunicationFilter
): CommunicationFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === "inbox" ||
    v === "unread" ||
    v === "starred" ||
    v === "archived" ||
    v === "unfiled" ||
    v === "filed" ||
    v === "untimed" ||
    v === "all"
  )
    return v;
  // Default landing - Inbox is the working surface (excludes archived
  // + snoozed); "All mail" is opt-in via the rail. A pinned-matter
  // drilldown defaults to every thread on the matter (see
  // defaultEmailFilter).
  return fallback;
}

function parseMessengerFilter(
  raw: string | string[] | undefined
): MessengerFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "unread" || v === "unfiled" || v === "pinned" || v === "all")
    return v;
  return "all";
}

export default async function CommunicationPage({
  searchParams,
}: PageProps<"/communication">) {
  await requireUser();
  const sp = await searchParams;
  const view = parseView(sp.view);
  const rawThread = Array.isArray(sp.thread) ? sp.thread[0] : sp.thread;
  const threadId = typeof rawThread === "string" ? rawThread : null;

  if (view === "messages") {
    const filter = parseMessengerFilter(sp.filter);
    // One wave: counts, lists, zone and the call permissions (whose
    // answers gate the contact / matter option lists chained below).
    const canLogCallP = currentUserHasPermission("communication.log_call");
    const canEditCallP = currentUserHasPermission("communication.edit_call");
    const [
      messengerCounts,
      emailUnread,
      tz,
      canLogCall,
      canEditCall,
      canDeleteCall,
      threadPage,
      selectedThread,
      callContacts,
      callMatters,
    ] = await Promise.all([
      getMessengerMailboxCounts(),
      // The inactive tab only needs its unread badge.
      getEmailUnreadCount(),
      getCurrentUserTimeZone(),
      canLogCallP,
      canEditCallP,
      currentUserHasPermission("communication.delete_call"),
      listMessengerThreads({ filter, page: parsePageParam(sp.page) }),
      threadId ? getMessengerThread(threadId) : Promise.resolve(null),
      canLogCallP.then((can) => (can ? listContactPickerOptions() : [])),
      // The matter option list feeds both the log-call composer and
      // the edit dialog's re-file select.
      Promise.all([canLogCallP, canEditCallP]).then(([log, edit]) =>
        log || edit ? getFilingMatterOptions() : []
      ),
    ]);
    const callMatterOptions = callMatters.map((m) => ({
      id: m.id,
      name: m.name,
    }));

    return (
      <MailboxDrawerProvider>
        <TopBar
          title="Communication"
          crumbs={`${messengerCounts.all} conversations · ${messengerCounts.unread} unread`}
          below={
            <CommunicationTabs
              view="messages"
              emailUnread={emailUnread}
              messengerUnread={messengerCounts.unread}
            />
          }
        />

        <div className="flex-1 flex min-h-0">
          <MailboxDrawer>
            <MessengerMailboxRail
              counts={messengerCounts}
              activeFilter={filter}
              selectedThreadId={selectedThread?.id ?? null}
            />
          </MailboxDrawer>
          <MessengerThreadList
            threads={threadPage.rows}
            paging={threadPage}
            filter={filter}
            // The thread that actually exists, not the raw URL param: a
            // stale / deleted ?thread= id would otherwise hide the list
            // on mobile while the reader renders nothing (dead end).
            selectedThreadId={selectedThread?.id ?? null}
            tz={tz}
            action={
              canLogCall ? (
                <LogCallButton
                  contacts={callContacts}
                  matters={callMatterOptions}
                />
              ) : null
            }
          />
          <MessengerThreadReader
            thread={selectedThread}
            canEditCall={canEditCall}
            canDeleteCall={canDeleteCall}
            callMatters={callMatterOptions}
            tz={tz}
          />
        </div>
      </MailboxDrawerProvider>
    );
  }

  // Email view (default)
  // Opportunistic Gmail sync kick, throttled to once per 5 min per
  // user inside `maybeKickEmailSync` (in-memory, like the dashboard's
  // notification sweep). It runs via after() so the platform keeps the
  // function alive until it finishes and it never competes with this
  // render's queries for the single pooled connection; it never fails
  // the page. The user id is resolved here (request data must be read
  // before the callback); freshly synced mail shows on the next load.
  const userId = await getCurrentUserId();
  after(async () => {
    try {
      await maybeKickEmailSync(userId);
    } catch {
      // A broken sync must never surface from the inbox page.
    }
  });
  // Per-pinned-matter drilldown: ?matter=<id> overrides matter-related
  // filter behavior to scope the list to that single matter.
  const rawMatter = Array.isArray(sp.matter) ? sp.matter[0] : sp.matter;
  const matterIdParam = typeof rawMatter === "string" ? rawMatter : null;
  const filter = parseEmailFilter(sp.filter, defaultEmailFilter(matterIdParam));

  const [
    emailCounts,
    messengerUnread,
    tz,
    threadPage,
    selectedThread,
    pinnedMatters,
    filingOptions,
  ] = await Promise.all([
    getCommunicationCounts(),
    // The inactive tab only needs its unread badge.
    getMessengerUnreadCount(),
    getCurrentUserTimeZone(),
    listThreads(filter, matterIdParam ?? undefined, parsePageParam(sp.page)),
    threadId ? getThreadById(threadId) : Promise.resolve(null),
    getCommunicationPinnedMatters(),
    // Open-matter list for the file-to-matter picker - only the
    // reader uses it, so skip the (unbounded) query until a thread is
    // open.
    threadId ? getFilingMatterOptions() : Promise.resolve([]),
  ]);

  return (
    <MailboxDrawerProvider>
      <TopBar
        title="Communication"
        crumbs={`${emailCounts.all} total · ${emailCounts.unread} unread`}
        actions={<SyncNowButton />}
        below={
          <CommunicationTabs
            view="email"
            emailUnread={emailCounts.unread}
            messengerUnread={messengerUnread}
          />
        }
      />

      <div className="flex-1 flex min-h-0">
        <MailboxDrawer>
          <MailboxRail
            counts={emailCounts}
            pinnedMatters={pinnedMatters}
            activeFilter={filter}
            activeMatterId={matterIdParam}
            selectedThreadId={selectedThread?.id ?? null}
          />
        </MailboxDrawer>
        <ThreadList
          threads={threadPage.rows}
          paging={threadPage}
          filter={filter}
          matterId={matterIdParam}
          matterLabel={
            matterIdParam
              ? (pinnedMatters.find((m) => m.id === matterIdParam)?.name ?? null)
              : null
          }
          selectedThreadId={selectedThread?.id ?? null}
          tz={tz}
        />
        <ThreadReader
          thread={selectedThread}
          filingOptions={filingOptions}
          tz={tz}
        />
      </div>
    </MailboxDrawerProvider>
  );
}
