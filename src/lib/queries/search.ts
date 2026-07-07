/**
 * Global text search — "which matter mentioned the ambulance report?"
 *
 * One query-layer entry point (`globalSearch`) that runs a
 * case-insensitive substring match (Prisma `contains` +
 * `mode: "insensitive"`, i.e. Postgres ILIKE) across every content-
 * bearing entity, grouped by type with a per-type `take` and a
 * per-type total count. All per-type searches fire in ONE parallel
 * batch (a single outer `Promise.all`).
 *
 * ── v1 scope / upgrade path ─────────────────────────────────────────
 * This is deliberately ILIKE v1: simple, correct, zero new infra.
 * ILIKE with a leading wildcard can't use btree indexes, so every
 * per-type search is a scan. Fine at small/mid-firm row counts;
 * when data outgrows it the upgrade path is Postgres full-text
 * search — a generated `tsvector` column per searched table (or a
 * materialized search view), a GIN index, `websearch_to_tsquery`
 * ranking via `ts_rank`, and `ts_headline` for snippets. The
 * `SearchHit` shape returned here was designed so that swap stays
 * invisible to the results page.
 *
 * ── Read-model guards (NO new permission keys) ──────────────────────
 * Search adds no permission surface of its own — it respects each
 * entity's existing read model, enforced server-side in this file:
 *
 *   - Calendar events run through the SAME visibility resolver as
 *     getCalendarItems (`canViewEventDetails`, src/lib/
 *     calendar-visibility.ts). Private events a viewer can't see
 *     never match and never leak snippets — they're dropped before
 *     any hit/snippet is built.
 *   - Time entries flagged `privileged` only match on their
 *     `narrative` for the entry's AUTHOR. The privilege flag exists
 *     precisely to keep that content out of casual surfaces; the
 *     `activity` line is billing-grade metadata and stays searchable.
 *   - Contacts: active only, merged losers (`mergedIntoId` set)
 *     excluded — same posture as the contacts directory.
 *
 * Everything else (matters, notes, documents, tasks, deadlines,
 * email, messenger) is firm-visible today, matching the read model
 * of its own list page.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { canViewEventDetails } from "@/lib/calendar-visibility";
import {
  SNIPPET_MARK_END,
  SNIPPET_MARK_START,
} from "@/components/search/snippet";

// ── Public shapes ───────────────────────────────────────────────────────

export const SEARCH_HIT_TYPES = [
  "matter",
  "contact",
  "lead",
  "note",
  "document",
  "task",
  "deadline",
  "event",
  "email",
  "message",
  "time",
] as const;

export type SearchHitType = (typeof SEARCH_HIT_TYPES)[number];

export function isSearchHitType(v: unknown): v is SearchHitType {
  return (
    typeof v === "string" && (SEARCH_HIT_TYPES as readonly string[]).includes(v)
  );
}

export type SearchHit = {
  type: SearchHitType;
  id: string;
  /** Primary display line (matter name, contact name, email subject…). */
  title: string;
  /** Matched text ±SNIPPET_RADIUS chars, the match wrapped in
   *  SNIPPET_MARK_START/END (see src/components/search/snippet.tsx).
   *  Null when the match was on the title itself and there's no
   *  secondary text worth quoting. */
  snippet: string | null;
  /** Deep link — matter tab routes, thread routes, ?event= modal, … */
  href: string;
  /** Context label — matter name where applicable, org for contacts. */
  context: string | null;
};

export type SearchGroup = {
  type: SearchHitType;
  /** Total matches of this type (may exceed hits.length). For the
   *  post-filtered types (events, notes) this is documented as an
   *  approximation — see the per-type notes below. */
  total: number;
  hits: SearchHit[];
};

export type GlobalSearchResult = {
  query: string;
  groups: SearchGroup[];
};

/** Queries shorter than this return no results (too noisy to scan). */
export const SEARCH_MIN_QUERY_LENGTH = 2;
/** Default hits per type on the grouped results page. */
export const SEARCH_GROUP_TAKE = 10;
/** Take used when a single type is expanded via ?type=. */
export const SEARCH_EXPANDED_TAKE = 100;

const SNIPPET_RADIUS = 60;
/** Candidate window for types whose read-model filter must run in
 *  JS (calendar visibility) or that need post-verification (note
 *  markup). */
const CANDIDATE_CAP = 200;

// ── Pure helpers (exported for tests) ───────────────────────────────────

/** Strip tags + decode the handful of entities the Tiptap sanitizer
 *  (src/lib/sanitize-html.ts) lets through, collapse whitespace.
 *  Good enough for snippets over sanitized note/email HTML — this is
 *  NOT a sanitizer (output is rendered as plain text by React). */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build a highlight-marked snippet: first case-insensitive
 *  occurrence of `query` in `text`, ±SNIPPET_RADIUS chars of
 *  context, ellipses when truncated, original casing preserved.
 *  Null when text is empty or the query doesn't occur (caller then
 *  tries the next field). */
export function makeSnippet(
  text: string | null | undefined,
  query: string
): string | null {
  if (!text) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, idx) +
    SNIPPET_MARK_START +
    text.slice(idx, idx + query.length) +
    SNIPPET_MARK_END +
    text.slice(idx + query.length, end) +
    (end < text.length ? "…" : "")
  );
}

/** Clip long derived titles (note bodies used as titles). */
function clip(s: string, max = 80): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── The search ──────────────────────────────────────────────────────────

export type GlobalSearchOptions = {
  /** Restrict to one type (the results page's "show all" expansion). */
  type?: SearchHitType;
  /** Per-type hit cap. Defaults to SEARCH_GROUP_TAKE, or
   *  SEARCH_EXPANDED_TAKE when `type` is set. */
  take?: number;
};

export async function globalSearch(
  rawQuery: string,
  opts?: GlobalSearchOptions
): Promise<GlobalSearchResult> {
  const q = rawQuery.trim();
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return { query: q, groups: [] };

  const take = Math.min(
    Math.max(1, opts?.take ?? (opts?.type ? SEARCH_EXPANDED_TAKE : SEARCH_GROUP_TAKE)),
    SEARCH_EXPANDED_TAKE
  );
  const viewerId = await getCurrentUserId();
  const qLower = q.toLowerCase();

  /** Shared ILIKE fragment. */
  const ci = { contains: q, mode: "insensitive" as const };

  // ── Per-type searchers ────────────────────────────────────────────
  // Each returns a full SearchGroup. They are invoked together in
  // the single Promise.all at the bottom — one parallel batch.

  const searchMatters = async (): Promise<SearchGroup> => {
    // Archived matters stay searchable on purpose: content
    // retrieval ("which matter mentioned…") is exactly when you
    // reach for an old case. The ⌘K palette hides archived rows
    // because it's a jump-to-recent surface; this isn't.
    const where = { OR: [{ name: ci }, { description: ci }] };
    const [rows, total] = await Promise.all([
      prisma.matter.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          client: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take,
      }),
      prisma.matter.count({ where }),
    ]);
    return {
      type: "matter",
      total,
      hits: rows.map((m) => ({
        type: "matter",
        id: m.id,
        title: m.name,
        snippet: makeSnippet(m.description, q),
        href: `/matters/${m.id}`,
        context: m.client?.name ?? null,
      })),
    };
  };

  const searchContacts = async (): Promise<SearchGroup> => {
    // Active only + merged losers excluded — the merged row is a
    // soft-deleted audit stub; the survivor carries the data.
    const where = {
      isActive: true,
      mergedIntoId: null,
      OR: [{ name: ci }, { email: ci }, { organization: ci }],
    };
    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        select: { id: true, name: true, email: true, organization: true },
        orderBy: { updatedAt: "desc" },
        take,
      }),
      prisma.contact.count({ where }),
    ]);
    return {
      type: "contact",
      total,
      hits: rows.map((c) => ({
        type: "contact",
        id: c.id,
        title: c.name,
        snippet: makeSnippet(c.email, q) ?? makeSnippet(c.organization, q),
        href: `/contacts/${c.id}`,
        context: c.organization,
      })),
    };
  };

  const searchLeads = async (): Promise<SearchGroup> => {
    // Name + the free-text intake fields (summary / injuries /
    // location) + email. All stages including converted/declined —
    // an old intake's story is still searchable history.
    const where = {
      OR: [
        { name: ci },
        { email: ci },
        { summary: ci },
        { injuries: ci },
        { location: ci },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          summary: true,
          injuries: true,
          location: true,
          stage: true,
        },
        orderBy: { updatedAt: "desc" },
        take,
      }),
      prisma.lead.count({ where }),
    ]);
    return {
      type: "lead",
      total,
      hits: rows.map((l) => ({
        type: "lead",
        id: l.id,
        title: l.name,
        snippet:
          makeSnippet(l.summary, q) ??
          makeSnippet(l.injuries, q) ??
          makeSnippet(l.location, q) ??
          makeSnippet(l.email, q),
        href: `/intake/${l.id}`,
        context: l.stage,
      })),
    };
  };

  const searchNotes = async (): Promise<SearchGroup> => {
    // Note bodies are sanitized Tiptap HTML. We match the RAW
    // column in SQL (an entity-split like "ambulance</p>" can't be
    // fixed by ILIKE anyway) but build title + snippet from the
    // tag-stripped text. A raw match that only hit markup (e.g. a
    // link href) is dropped from the hits after stripping, so
    // `total` (the SQL count) is an upper bound for this type —
    // acceptable ILIKE-v1 slack, gone once FTS indexes the
    // stripped text.
    const where = { content: ci };
    const [rows, total] = await Promise.all([
      prisma.note.findMany({
        where,
        select: {
          id: true,
          content: true,
          matterId: true,
          matter: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: Math.max(take * 3, 30),
      }),
      prisma.note.count({ where }),
    ]);
    const hits: SearchHit[] = [];
    for (const n of rows) {
      if (hits.length >= take) break;
      const text = stripHtmlTags(n.content);
      if (!text.toLowerCase().includes(qLower)) continue; // markup-only match
      hits.push({
        type: "note",
        id: n.id,
        title: clip(text),
        snippet: makeSnippet(text, q),
        href: `/matters/${n.matterId}/notes`,
        context: n.matter.name,
      });
    }
    return { type: "note", total, hits };
  };

  const searchDocuments = async (): Promise<SearchGroup> => {
    // Document has no description column (the schema is the truth
    // here) — name is the only text field worth matching.
    const where = { name: ci };
    const [rows, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: {
          id: true,
          name: true,
          matterId: true,
          matter: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take,
      }),
      prisma.document.count({ where }),
    ]);
    return {
      type: "document",
      total,
      hits: rows.map((d) => ({
        type: "document",
        id: d.id,
        title: d.name,
        snippet: null,
        href: `/matters/${d.matterId}/documents`,
        context: d.matter.name,
      })),
    };
  };

  const searchTasks = async (): Promise<SearchGroup> => {
    const where = { OR: [{ title: ci }, { description: ci }] };
    const [rows, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          matter: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take,
      }),
      prisma.task.count({ where }),
    ]);
    return {
      type: "task",
      total,
      hits: rows.map((t) => ({
        type: "task",
        id: t.id,
        title: t.title,
        snippet: makeSnippet(t.description, q),
        // Firm-wide tasks (no matter) have no dedicated page — they
        // surface on the dashboard's "Your tasks" card.
        href: t.matter ? `/matters/${t.matter.id}/tasks` : "/",
        context: t.matter?.name ?? "Firm-wide",
      })),
    };
  };

  const searchDeadlines = async (): Promise<SearchGroup> => {
    const where = { OR: [{ title: ci }, { description: ci }] };
    const [rows, total] = await Promise.all([
      prisma.deadline.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          matterId: true,
          matter: { select: { name: true } },
        },
        orderBy: { dueDate: "desc" },
        take,
      }),
      prisma.deadline.count({ where }),
    ]);
    return {
      type: "deadline",
      total,
      hits: rows.map((d) => ({
        type: "deadline",
        id: d.id,
        title: d.title,
        snippet: makeSnippet(d.description, q),
        href: `/matters/${d.matterId}/deadlines`,
        context: d.matter.name,
      })),
    };
  };

  const searchEvents = async (): Promise<SearchGroup> => {
    // MUST respect the calendar visibility model: candidates are
    // fetched with the same relations getCalendarItems pulls, run
    // through the same resolver (canViewEventDetails), and events
    // the viewer can't see are dropped BEFORE any hit or snippet is
    // built — a private event never matches and never leaks text.
    // Because the resolver runs in JS, no SQL count can respect it;
    // `total` is the visible count within a CANDIDATE_CAP window
    // (a documented v1 approximation).
    const candidates = await prisma.calendarEvent.findMany({
      where: { OR: [{ title: ci }, { description: ci }, { location: ci }] },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        visibility: true,
        createdById: true,
        startTime: true,
        matter: {
          select: {
            id: true,
            name: true,
            teamMembers: {
              where: { removedAt: null },
              select: { userId: true },
            },
          },
        },
        createdBy: { select: { defaultEventVisibility: true } },
        attendees: { select: { userId: true } },
      },
      orderBy: { startTime: "desc" },
      take: CANDIDATE_CAP,
    });
    const visible = candidates.filter((e) =>
      canViewEventDetails({
        viewerId,
        createdById: e.createdById,
        eventVisibility: e.visibility,
        creatorDefaultEventVisibility:
          e.createdBy?.defaultEventVisibility ?? null,
        matterId: e.matter?.id ?? null,
        attendeeUserIds: e.attendees
          .map((a) => a.userId)
          .filter((id): id is string => !!id),
        matterTeamUserIds: e.matter?.teamMembers.map((m) => m.userId) ?? [],
      })
    );
    return {
      type: "event",
      total: visible.length,
      hits: visible.slice(0, take).map((e) => ({
        type: "event",
        id: e.id,
        title: e.title,
        snippet: makeSnippet(e.description, q) ?? makeSnippet(e.location, q),
        // ?event= drives the calendar's URL-driven detail modal.
        href: `/calendar?event=${e.id}`,
        context: e.matter?.name ?? null,
      })),
    };
  };

  const searchEmail = async (): Promise<SearchGroup> => {
    // Thread-level hits: subject + stored snippet + any message
    // body. The matched message is fetched alongside (filtered
    // include, newest first) so the snippet can quote the actual
    // matching body when subject/snippet didn't match.
    const where = {
      OR: [
        { subject: ci },
        { snippet: ci },
        { messages: { some: { body: ci } } },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.emailThread.findMany({
        where,
        select: {
          id: true,
          subject: true,
          snippet: true,
          matter: { select: { name: true } },
          messages: {
            where: { body: ci },
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { body: true },
          },
        },
        orderBy: { lastMessageAt: "desc" },
        take,
      }),
      prisma.emailThread.count({ where }),
    ]);
    return {
      type: "email",
      total,
      hits: rows.map((t) => {
        const matchedBody = t.messages[0]?.body;
        return {
          type: "email",
          id: t.id,
          title: t.subject || "(no subject)",
          snippet:
            makeSnippet(t.snippet, q) ??
            (matchedBody ? makeSnippet(stripHtmlTags(matchedBody), q) : null),
          href: `/communication?view=email&thread=${t.id}`,
          context: t.matter?.name ?? null,
        };
      }),
    };
  };

  const MESSENGER_KIND_LABEL: Record<string, string> = {
    sms: "SMS",
    call: "Call",
    voicemail: "Voicemail",
  };

  const searchMessages = async (): Promise<SearchGroup> => {
    // SMS bodies + voicemail/call transcripts. Hits deep-link to
    // the thread (per-item anchors don't exist yet).
    const where = { OR: [{ body: ci }, { transcript: ci }] };
    const [rows, total] = await Promise.all([
      prisma.messengerItem.findMany({
        where,
        select: {
          id: true,
          kind: true,
          body: true,
          transcript: true,
          threadId: true,
          thread: {
            select: {
              contactPhone: true,
              contact: { select: { name: true } },
              defaultMatter: { select: { name: true } },
            },
          },
          matter: { select: { name: true } },
        },
        orderBy: { occurredAt: "desc" },
        take,
      }),
      prisma.messengerItem.count({ where }),
    ]);
    return {
      type: "message",
      total,
      hits: rows.map((m) => ({
        type: "message",
        id: m.id,
        title: `${MESSENGER_KIND_LABEL[m.kind] ?? "Message"} · ${
          m.thread.contact?.name ?? m.thread.contactPhone
        }`,
        snippet: makeSnippet(m.body, q) ?? makeSnippet(m.transcript, q),
        href: `/communication?view=messages&thread=${m.threadId}`,
        // Per-item override falls back to the thread's default
        // matter — same resolution the inbox uses.
        context: m.matter?.name ?? m.thread.defaultMatter?.name ?? null,
      })),
    };
  };

  const searchTime = async (): Promise<SearchGroup> => {
    // The `privileged` flag exists precisely to keep narrative
    // content out of casual surfaces (privilege / work-product
    // review): a privileged entry's narrative only matches — and is
    // only ever quoted — for the entry's author. The activity line
    // is billing metadata and stays searchable for everyone.
    const where = {
      OR: [
        { activity: ci },
        {
          AND: [
            { narrative: ci },
            { OR: [{ privileged: false }, { userId: viewerId }] },
          ],
        },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        select: {
          id: true,
          activity: true,
          narrative: true,
          privileged: true,
          userId: true,
          matterId: true,
          matter: { select: { name: true } },
        },
        orderBy: { date: "desc" },
        take,
      }),
      prisma.timeEntry.count({ where }),
    ]);
    return {
      type: "time",
      total,
      hits: rows.map((t) => {
        const canQuoteNarrative = !t.privileged || t.userId === viewerId;
        return {
          type: "time",
          id: t.id,
          title: clip(t.activity),
          snippet:
            makeSnippet(t.activity, q) ??
            (canQuoteNarrative ? makeSnippet(t.narrative, q) : null),
          href: `/matters/${t.matterId}/time`,
          context: t.matter.name,
        };
      }),
    };
  };

  const SEARCHERS: Record<SearchHitType, () => Promise<SearchGroup>> = {
    matter: searchMatters,
    contact: searchContacts,
    lead: searchLeads,
    note: searchNotes,
    document: searchDocuments,
    task: searchTasks,
    deadline: searchDeadlines,
    event: searchEvents,
    email: searchEmail,
    message: searchMessages,
    time: searchTime,
  };

  // ONE parallel batch — every enabled type fires simultaneously.
  const enabledTypes = SEARCH_HIT_TYPES.filter(
    (t) => !opts?.type || opts.type === t
  );
  const groups = await Promise.all(enabledTypes.map((t) => SEARCHERS[t]()));

  return {
    query: q,
    groups: groups.filter((g) => g.total > 0),
  };
}
