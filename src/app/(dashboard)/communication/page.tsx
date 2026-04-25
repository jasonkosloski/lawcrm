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
 * Read-only for both views in v0. Compose / reply / file-to-matter
 * land alongside the Gmail and Quo integrations.
 */

import { TopBar } from "@/components/layout/topbar";
import { CommunicationTabs } from "@/components/communication/communication-tabs";
import { MailboxRail } from "@/components/communication/mailbox-rail";
import { ThreadList } from "@/components/communication/thread-list";
import { ThreadReader } from "@/components/communication/thread-reader";
import { MessengerMailboxRail, type MessengerFilter } from "@/components/communication/messenger-mailbox-rail";
import { MessengerThreadList } from "@/components/communication/messenger-thread-list";
import { MessengerThreadReader } from "@/components/communication/messenger-thread-reader";
import {
  getCommunicationCounts,
  getCommunicationPinnedMatters,
  getFilingMatterOptions,
  getThreadById,
  listThreads,
  type CommunicationFilter,
} from "@/lib/queries/communication";
import {
  getMessengerMailboxCounts,
  getMessengerThread,
  listMessengerThreads,
} from "@/lib/queries/messenger";

type View = "email" | "messages";

function parseView(raw: string | string[] | undefined): View {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "messages" ? "messages" : "email";
}

function parseEmailFilter(
  raw: string | string[] | undefined
): CommunicationFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === "unread" ||
    v === "starred" ||
    v === "unfiled" ||
    v === "filed" ||
    v === "untimed" ||
    v === "all"
  )
    return v;
  return "all";
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
  const sp = await searchParams;
  const view = parseView(sp.view);
  const rawThread = Array.isArray(sp.thread) ? sp.thread[0] : sp.thread;
  const threadId = typeof rawThread === "string" ? rawThread : null;

  // Both views need cross-tab unread counts so the tab badges stay
  // honest regardless of which view the user is on.
  const [emailCounts, messengerCounts] = await Promise.all([
    getCommunicationCounts(),
    getMessengerMailboxCounts(),
  ]);

  if (view === "messages") {
    const filter = parseMessengerFilter(sp.filter);
    const [threads, selectedThread] = await Promise.all([
      listMessengerThreads({ filter }),
      threadId ? getMessengerThread(threadId) : Promise.resolve(null),
    ]);

    return (
      <>
        <TopBar
          title="Communication"
          crumbs={`${messengerCounts.all} conversations · ${messengerCounts.unread} unread`}
          below={
            <CommunicationTabs
              view="messages"
              emailUnread={emailCounts.unread}
              messengerUnread={messengerCounts.unread}
            />
          }
        />

        <div className="flex-1 flex min-h-0">
          <MessengerMailboxRail
            counts={messengerCounts}
            activeFilter={filter}
            selectedThreadId={threadId}
          />
          <MessengerThreadList
            threads={threads}
            filter={filter}
            selectedThreadId={threadId}
          />
          <MessengerThreadReader thread={selectedThread} />
        </div>
      </>
    );
  }

  // Email view (default)
  const filter = parseEmailFilter(sp.filter);
  // Per-pinned-matter drilldown: ?matter=<id> overrides matter-related
  // filter behavior to scope the list to that single matter.
  const rawMatter = Array.isArray(sp.matter) ? sp.matter[0] : sp.matter;
  const matterIdParam = typeof rawMatter === "string" ? rawMatter : null;

  const [threads, selectedThread, pinnedMatters, filingOptions] =
    await Promise.all([
      listThreads(filter, matterIdParam ?? undefined),
      threadId ? getThreadById(threadId) : Promise.resolve(null),
      getCommunicationPinnedMatters(),
      // Open-matter list for the file-to-matter picker. Cheap query
      // even on 1000s of matters; cached server-side per request.
      getFilingMatterOptions(),
    ]);

  return (
    <>
      <TopBar
        title="Communication"
        crumbs={`${emailCounts.all} total · ${emailCounts.unread} unread`}
        below={
          <CommunicationTabs
            view="email"
            emailUnread={emailCounts.unread}
            messengerUnread={messengerCounts.unread}
          />
        }
      />

      <div className="flex-1 flex min-h-0">
        <MailboxRail
          counts={emailCounts}
          pinnedMatters={pinnedMatters}
          activeFilter={filter}
          activeMatterId={matterIdParam}
          selectedThreadId={threadId}
        />
        <ThreadList
          threads={threads}
          filter={filter}
          matterId={matterIdParam}
          matterLabel={
            matterIdParam
              ? (pinnedMatters.find((m) => m.id === matterIdParam)?.name ?? null)
              : null
          }
          selectedThreadId={threadId}
        />
        <ThreadReader
          thread={selectedThread}
          filingOptions={filingOptions}
        />
      </div>
    </>
  );
}
