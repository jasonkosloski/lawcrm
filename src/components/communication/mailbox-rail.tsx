/**
 * Mailbox Rail
 *
 * Left-rail filter pills + per-matter drilldowns for the email view
 * of the Communication page. Server component — each entry is a
 * `<Link>` that updates `?filter=` and/or `?matter=` params so the
 * whole thing is deep-linkable and back-button-honest.
 *
 * Three sections:
 *   - Mailboxes — flat filters: All / Unread / Starred / Untimed
 *   - By matter — Filed / Unfiled
 *   - Pinned matters — one entry per pinned matter with email count
 */

import Link from "next/link";
import {
  Archive,
  Briefcase,
  Clock,
  FileQuestion,
  Inbox,
  Layers,
  MailOpen,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CommPinnedMatter,
  CommunicationCounts,
  CommunicationFilter,
} from "@/lib/queries/communication";

type RailItem = {
  filter: CommunicationFilter;
  label: string;
  icon: typeof Inbox;
};

const MAILBOX_ITEMS: RailItem[] = [
  // Inbox sits at the top — most users want this most of the time.
  // Excludes archived + snoozed (followUpAt in the future).
  { filter: "inbox", label: "Inbox", icon: Inbox },
  { filter: "all", label: "All mail", icon: Layers },
  { filter: "unread", label: "Unread", icon: MailOpen },
  { filter: "starred", label: "Starred", icon: Star },
  { filter: "untimed", label: "Untimed (mine)", icon: Clock },
];

const MATTER_ITEMS: RailItem[] = [
  { filter: "filed", label: "On a matter", icon: Briefcase },
  { filter: "unfiled", label: "Unfiled", icon: FileQuestion },
];

function hrefFor(
  filter: CommunicationFilter | null,
  matterId: string | null,
  threadId: string | null
): string {
  const params = new URLSearchParams();
  // Inbox is the default — only emit ?filter= when picking
  // something else, so the canonical URL stays clean.
  if (filter && filter !== "inbox") params.set("filter", filter);
  if (matterId) params.set("matter", matterId);
  if (threadId) params.set("thread", threadId);
  const qs = params.toString();
  return qs ? `/communication?${qs}` : "/communication";
}

export function MailboxRail({
  counts,
  pinnedMatters,
  activeFilter,
  /** When set, rail highlights the matching pinned-matter entry
   *  instead of any flat-filter row. */
  activeMatterId,
  selectedThreadId,
}: {
  counts: CommunicationCounts;
  pinnedMatters: CommPinnedMatter[];
  activeFilter: CommunicationFilter;
  activeMatterId: string | null;
  selectedThreadId: string | null;
}) {
  return (
    <aside className="hidden lg:flex w-52 shrink-0 border-r border-line bg-paper-2/30 flex-col py-3 overflow-y-auto">
      <Section label="Mailboxes">
        {MAILBOX_ITEMS.map((item) => (
          <RailRow
            key={item.filter}
            label={item.label}
            icon={<item.icon size={13} />}
            href={hrefFor(item.filter, null, selectedThreadId)}
            count={counts[item.filter]}
            active={activeMatterId === null && activeFilter === item.filter}
          />
        ))}
      </Section>

      <Section label="By matter">
        {MATTER_ITEMS.map((item) => (
          <RailRow
            key={item.filter}
            label={item.label}
            icon={<item.icon size={13} />}
            href={hrefFor(item.filter, null, selectedThreadId)}
            count={counts[item.filter]}
            active={activeMatterId === null && activeFilter === item.filter}
          />
        ))}
      </Section>

      {pinnedMatters.length > 0 && (
        <Section label="Pinned matters">
          {pinnedMatters.map((m) => (
            <RailRow
              key={m.id}
              label={m.name}
              dotColor={m.color}
              href={hrefFor(null, m.id, selectedThreadId)}
              count={m.threadCount}
              active={activeMatterId === m.id}
              title={`${m.name} · ${m.area}`}
            />
          ))}
        </Section>
      )}
    </aside>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col mb-2">
      <div className="px-3 pb-1 pt-1 text-2xs font-mono uppercase tracking-wider text-ink-4">
        {label}
      </div>
      <nav className="flex flex-col gap-px px-1.5">{children}</nav>
    </div>
  );
}

function RailRow({
  label,
  href,
  count,
  active,
  icon,
  dotColor,
  title,
}: {
  label: string;
  href: string;
  count: number;
  active: boolean;
  icon?: React.ReactNode;
  dotColor?: string;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
        active
          ? "bg-brand-500 text-white"
          : "text-ink-2 hover:bg-[#eaf0f5] hover:text-brand-700"
      )}
    >
      {icon ? (
        <span className={active ? "text-white" : "text-ink-3"}>{icon}</span>
      ) : dotColor ? (
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: dotColor }}
        />
      ) : null}
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            "text-2xs font-mono font-medium px-1.5 py-px rounded-lg border",
            active
              ? "bg-white/[.18] text-white border-transparent"
              : "bg-brand-50 text-brand-700 border-brand-100"
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
