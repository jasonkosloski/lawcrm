/**
 * Grouped search results.
 *
 * Server-rendered: one section per entity type with a count badge,
 * highlighted snippets (see ./snippet.tsx for the marker protocol),
 * and a per-group "Show all N" link that expands the group via the
 * ?type= param. When a type is expanded, a "All results" link leads
 * back to the grouped view.
 */

import Link from "next/link";
import {
  AlarmClock,
  ArrowLeft,
  Calendar,
  CheckSquare,
  Clock,
  FileText,
  Gavel,
  Inbox,
  Mail,
  MessageSquare,
  StickyNote,
  User,
  type LucideIcon,
} from "lucide-react";
import type {
  GlobalSearchResult,
  SearchGroup,
  SearchHit,
  SearchHitType,
} from "@/lib/queries/search";
import { SearchSnippet } from "./snippet";

export const TYPE_META: Record<
  SearchHitType,
  { label: string; icon: LucideIcon }
> = {
  matter: { label: "Matters", icon: Gavel },
  contact: { label: "Contacts", icon: User },
  lead: { label: "Leads", icon: Inbox },
  note: { label: "Notes", icon: StickyNote },
  document: { label: "Documents", icon: FileText },
  task: { label: "Tasks", icon: CheckSquare },
  deadline: { label: "Deadlines", icon: AlarmClock },
  event: { label: "Events", icon: Calendar },
  email: { label: "Email", icon: Mail },
  message: { label: "Messages", icon: MessageSquare },
  time: { label: "Time entries", icon: Clock },
};

export function SearchResults({
  result,
  expandedType,
}: {
  result: GlobalSearchResult;
  expandedType: SearchHitType | null;
}) {
  const backHref = `/search?q=${encodeURIComponent(result.query)}`;
  return (
    <div className="flex flex-col gap-4">
      {expandedType && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 self-start text-xs text-ink-3 hover:text-brand-700 transition-colors"
        >
          <ArrowLeft size={13} />
          All results
        </Link>
      )}
      {result.groups.map((group) => (
        <GroupSection
          key={group.type}
          group={group}
          query={result.query}
          expanded={expandedType === group.type}
        />
      ))}
    </div>
  );
}

function GroupSection({
  group,
  query,
  expanded,
}: {
  group: SearchGroup;
  query: string;
  expanded: boolean;
}) {
  const meta = TYPE_META[group.type];
  const Icon = meta.icon;
  const showAllHref = `/search?q=${encodeURIComponent(query)}&type=${group.type}`;
  return (
    <section aria-label={meta.label}>
      <div className="flex items-center gap-2 mb-1.5 px-1">
        <Icon size={13} className="text-ink-4" />
        <h2 className="text-xs font-medium text-ink-2">{meta.label}</h2>
        <span className="font-mono text-2xs text-ink-4">{group.total}</span>
      </div>
      <div className="rounded-lg border border-line bg-card divide-y divide-line">
        {group.hits.map((hit) => (
          <HitRow key={`${hit.type}-${hit.id}`} hit={hit} />
        ))}
        {group.total > group.hits.length && !expanded && (
          <Link
            href={showAllHref}
            className="block px-3 py-2 text-xs text-brand-700 hover:bg-paper-2 transition-colors"
          >
            Show all {group.total} {meta.label.toLowerCase()}
          </Link>
        )}
        {expanded && group.total > group.hits.length && (
          <div className="px-3 py-2 text-2xs text-ink-4">
            Showing the first {group.hits.length} of {group.total} — refine the
            query to narrow further.
          </div>
        )}
      </div>
    </section>
  );
}

function HitRow({ hit }: { hit: SearchHit }) {
  return (
    <Link
      href={hit.href}
      className="flex items-start gap-3 px-3 py-2 hover:bg-paper-2 transition-colors"
    >
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <span className="text-sm text-ink truncate">{hit.title}</span>
        {hit.snippet && (
          <span className="line-clamp-2">
            <SearchSnippet snippet={hit.snippet} />
          </span>
        )}
      </div>
      {hit.context && (
        <span className="shrink-0 max-w-40 truncate font-mono text-2xs text-ink-4 pt-1">
          {hit.context}
        </span>
      )}
    </Link>
  );
}
