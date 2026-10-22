/**
 * Global text search — "which matter mentioned the ambulance report?"
 *
 * One query-layer entry point (`globalSearch`) that runs a
 * case-insensitive substring match (Prisma `contains` +
 * `mode: "insensitive"`, i.e. Postgres ILIKE) across every content-
 * bearing entity, grouped by type with a per-type `take` and a
 * per-type total count. All per-type searches are issued from a
 * single outer `Promise.all`; note the Prisma pool is one connection
 * (src/lib/prisma.ts, `max: 1`), so in production the ~21 statements
 * (findMany + count per type) actually execute one after another.
 * LIKE metacharacters in the query (% _ and backslash) are escaped
 * so they match literally (see `escapeLike`).
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
 *   - Matter access (ethical walls, src/lib/matter-access.ts): every
 *     matter-scoped group (matters, notes, documents, tasks, deadlines,
 *     events, time, messages) only matches rows on matters the viewer
 *     may see, in the SQL where so counts agree. Email/message hits
 *     filed to a hidden matter drop the matter name.
 *   - Time entries: a `privileged` narrative is searchable and quoted
 *     for anyone who can access the entry's matter (hidden matters are
 *     already filtered out above), matching the Time tabs.
 *   - Contacts: active only, merged losers (`mergedIntoId` set)
 *     excluded — same posture as the contacts directory.
 *
 *   - Email is mailbox-personal: only threads on the viewer's own
 *     EmailAccount match (`visibleEmailThreadWhere`, src/lib/
 *     email-visibility.ts) — hits, snippets and the group total.
 *
 * Everything else (matters, notes, documents, tasks, deadlines,
 * messenger) is firm-visible today, matching the read model of its
 * own list page.
 */

import { prisma } from "@/lib/prisma";
import { scopeBasePath, scopeOf } from "@/lib/record-scope";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { visibleEmailThreadWhere } from "@/lib/email-visibility";
import { canViewEventDetails } from "@/lib/calendar-visibility";
import {
  filterAccessibleMatterIds,
  matterAccessWhere,
  matterRelationAccessWhere,
  optionalRecordAccessClause,
} from "@/lib/matter-access";
import { leadAccessWhere } from "@/lib/lead-access";
import {
  SNIPPET_MARK_END,
  SNIPPET_MARK_START,
} from "@/components/search/snippet";

// ── Public shapes ───────────────────────────────────────────────────────

// The hit-type list and thresholds live in a client-safe module so the
// palette, the saved-search chips and this file cannot drift. Re-
// exported for the long-standing importers of this module.
import {
  isSearchHitType,
  SEARCH_HIT_TYPES,
  normalizeSearchQuery,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
  type SearchHitType,
} from "@/lib/constants/search";

export {
  isSearchHitType,
  normalizeSearchQuery,
  SEARCH_HIT_TYPES,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
  type SearchHitType,
};

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
  /** Deep link — matter tab routes, thread routes, ?event= modal, …
   *  Null when no page would show the hit (a firm-wide task): the
   *  results page renders it unlinked. */
  href: string | null;
  /** Context label — matter name where applicable, org for contacts. */
  context: string | null;
  /** Transcript hits only: the document, speaker and moment found. */
  documentId?: string;
  speakerName?: string;
  startSeconds?: number;
};

export type SearchGroup = {
  type: SearchHitType;
  /** Total matches of this type (may exceed hits.length). For the
   *  post-filtered types this is an approximation — see the per-type
   *  notes below (events: the visible count inside a CANDIDATE_CAP
   *  window, a lower bound; notes/email: the SQL count minus the
   *  markup-only rows that were scanned, an upper bound). */
  total: number;
  hits: SearchHit[];
};

export type GlobalSearchResult = {
  query: string;
  groups: SearchGroup[];
};

/** Default hits per type on the grouped results page. */
export const SEARCH_GROUP_TAKE = 10;
/** Take used when a single type is expanded via ?type=. */
export const SEARCH_EXPANDED_TAKE = 100;

const SNIPPET_RADIUS = 60;
/** Candidate window for types whose read-model filter must run in
 *  JS (calendar visibility). */
const CANDIDATE_CAP = 200;
/** Notes are matched on raw HTML in SQL, then verified against the
 *  tag-stripped text. We page through candidates (newest first) until
 *  `take` real hits are found, bounded so a pathological query (an
 *  HTML tag name like "strong") can't become a full-table read. */
const NOTE_SCAN_PAGE = 100;
const NOTE_SCAN_MAX_PAGES = 5;
/** Matching messages fetched per email thread, so a markup-only match
 *  on the newest message can't hide a real one on an older message. */
const EMAIL_BODY_CANDIDATES = 3;
/** Extra pages of EMAIL_BODY_CANDIDATES older matching messages
 *  examined per thread when the newest ones were all markup-only. */
const EMAIL_BODY_MAX_EXTRA_PAGES = 5;
/** Candidate threads per page of the email scan. */
const EMAIL_SCAN_PAGE = 50;

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

/** Escape LIKE/ILIKE metacharacters. Prisma's `contains` and
 *  insensitive `equals` put the value into an ILIKE pattern without
 *  escaping, so a raw "%" or "_" over-matches ("__" matches every
 *  row) and a trailing backslash is a Postgres error. Postgres'
 *  default LIKE escape character is backslash. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/** `s` as the HTML sanitizers store it ("Smith & Wesson" becomes
 *  "Smith &amp; Wesson"). */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const q = normalizeSearchQuery(rawQuery);
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return { query: q, groups: [] };

  const take = Math.min(
    Math.max(1, opts?.take ?? (opts?.type ? SEARCH_EXPANDED_TAKE : SEARCH_GROUP_TAKE)),
    SEARCH_EXPANDED_TAKE
  );
  const viewerId = await getCurrentUserId();
  const qLower = q.toLowerCase();
  const accessMatter = await matterAccessWhere(viewerId);
  const accessRel = await matterRelationAccessWhere(viewerId);
  // Every `accessOpt` model carries matterId + leadId: rows on a
  // hidden matter OR a restricted lead the viewer isn't on drop out.
  const accessOpt = await optionalRecordAccessClause(viewerId);
  const accessLead = await leadAccessWhere(viewerId);

  /** Shared ILIKE fragment (LIKE metacharacters escaped). */
  const ci = { contains: escapeLike(q), mode: "insensitive" as const };
  /** Same, for columns that hold sanitized HTML: a query containing
   *  & < > " is stored entity-encoded, so also try the encoded form. */
  const qHtml = escapeHtmlText(q);
  const ciHtml: Array<{ contains: string; mode: "insensitive" }> =
    qHtml === q
      ? [ci]
      : [ci, { contains: escapeLike(qHtml), mode: "insensitive" as const }];

  // ── Per-type searchers ────────────────────────────────────────────
  // Each returns a full SearchGroup. They are invoked together in
  // the single Promise.all at the bottom.

  const searchMatters = async (): Promise<SearchGroup> => {
    // Archived matters stay searchable on purpose: content
    // retrieval ("which matter mentioned…") is exactly when you
    // reach for an old case. The ⌘K palette hides archived rows
    // because it's a jump-to-recent surface; this isn't.
    // caseNumber / court / opposing* are how a lawyer looks a case up
    // ("2026-CV-00481", the other side's name), and the palette only
    // preloads active matters.
    const where = {
      AND: [accessMatter],
      OR: [
        { name: ci },
        { description: ci },
        { caseNumber: ci },
        { court: ci },
        { opposingParty: ci },
        { opposingFirm: ci },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.matter.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          caseNumber: true,
          court: true,
          opposingParty: true,
          opposingFirm: true,
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
        snippet:
          makeSnippet(m.description, q) ??
          makeSnippet(m.caseNumber, q) ??
          makeSnippet(m.opposingParty, q) ??
          makeSnippet(m.opposingFirm, q) ??
          makeSnippet(m.court, q),
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
    // an old intake's story is still searchable history. Restricted
    // leads only for their team (ADR-049).
    const where = {
      ...accessLead,
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
    // tag-stripped text. A raw match that only hit markup (a link's
    // rel="noopener", <strong>, <code>…) is dropped after stripping.
    // Because recent markup-only notes could otherwise fill a small
    // candidate window and hide older real hits, we page through
    // candidates (bounded by NOTE_SCAN_MAX_PAGES) until `take` real
    // hits are found. `total` is the SQL count minus the markup-only
    // rows we scanned: exact when the scan reached the end, an upper
    // bound otherwise — gone once FTS indexes the stripped text.
    // Note.matter is optional (intake notes hang off a Lead), so the
    // record clause: matter notes need matter access, lead notes lead
    // access.
    const where = {
      AND: [...accessOpt, { OR: ciHtml.map((c) => ({ content: c })) }],
    };
    const total = await prisma.note.count({ where });
    const hits: SearchHit[] = [];
    let markupOnly = 0;
    for (let page = 0; page < NOTE_SCAN_MAX_PAGES; page++) {
      const rows = await prisma.note.findMany({
        where,
        select: {
          id: true,
          content: true,
          matterId: true,
          matter: { select: { name: true } },
          leadId: true,
          lead: { select: { name: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: page * NOTE_SCAN_PAGE,
        take: NOTE_SCAN_PAGE,
      });
      for (const n of rows) {
        if (hits.length >= take) break;
        const text = stripHtmlTags(n.content);
        if (!text.toLowerCase().includes(qLower)) {
          markupOnly++; // matched markup only
          continue;
        }
        hits.push({
          type: "note",
          id: n.id,
          title: clip(text),
          snippet: makeSnippet(text, q),
          // Intake notes route to the lead's Notes tab (time-entry
          // hits above use the same fallback chain).
          href: n.matterId
            ? `/matters/${n.matterId}/notes`
            : n.leadId
              ? `/intake/${n.leadId}/notes`
              : `/search`,
          context:
            n.matter?.name ??
            (n.lead ? `Intake · ${n.lead.name}` : "Intake"),
        });
      }
      if (hits.length >= take || rows.length < NOTE_SCAN_PAGE) break;
    }
    return { type: "note", total: Math.max(total - markupOnly, hits.length), hits };
  };

  const searchDocuments = async (): Promise<SearchGroup> => {
    // Document has no description column (the schema is the truth
    // here) — name is the only text field worth matching.
    const where = { AND: [...accessOpt], name: ci };
    const [rows, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: {
          id: true,
          name: true,
          matterId: true,
          leadId: true,
          matter: { select: { name: true } },
          lead: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take,
      }),
      prisma.document.count({ where }),
    ]);
    return {
      type: "document",
      total,
      hits: rows.flatMap((d) => {
        // One malformed row (neither/both scope ids) must not fail the
        // whole global search — skip it and say so.
        let base: string;
        try {
          base = scopeBasePath(scopeOf(d));
        } catch (err) {
          console.warn("[search] skipping document with no derivable scope", {
            id: d.id,
            err,
          });
          return [];
        }
        return [
          {
            type: "document" as const,
            id: d.id,
            title: d.name,
            snippet: null,
            // The viewer route, not the tab root: the Documents tab lists
            // one folder at a time, so a file in a subfolder isn't there.
            href: `${base}/documents/${d.id}`,
            context:
              d.matter?.name ?? (d.lead ? `Intake · ${d.lead.name}` : "Intake"),
          },
        ];
      }),
    };
  };

  const searchTranscripts = async (): Promise<SearchGroup> => {
    // Same Document read model as searchDocuments (matter walls + lead
    // scope), reached through segment -> transcript -> document. Only
    // completed transcripts; a partial/failed one is not a record.
    const where = {
      text: ci,
      transcript: {
        status: "completed",
        document: { AND: [...accessOpt] },
      },
    };
    const [rows, total] = await Promise.all([
      prisma.transcriptSegment.findMany({
        where,
        select: {
          text: true,
          speaker: true,
          startSeconds: true,
          transcript: {
            select: {
              speakers: true,
              document: {
                select: {
                  id: true,
                  name: true,
                  matterId: true,
                  leadId: true,
                  matter: { select: { name: true } },
                  lead: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: [{ transcript: { completedAt: "desc" } }, { startSeconds: "asc" }],
        take,
      }),
      prisma.transcriptSegment.count({ where }),
    ]);
    return {
      type: "transcript",
      total,
      hits: rows.flatMap((r) => {
        const d = r.transcript.document;
        let base: string;
        try {
          base = scopeBasePath(scopeOf(d));
        } catch (err) {
          console.warn("[search] skipping transcript with no derivable scope", {
            id: d.id,
            err,
          });
          return [];
        }
        const names = (r.transcript.speakers ?? {}) as Record<string, unknown>;
        const mapped = names[r.speaker];
        return [
          {
            type: "transcript" as const,
            id: `${d.id}:${r.startSeconds}`,
            title: d.name,
            snippet: makeSnippet(r.text, q),
            href: `${base}/documents/${d.id}?t=${Math.floor(r.startSeconds)}`,
            context:
              d.matter?.name ?? (d.lead ? `Intake · ${d.lead.name}` : "Intake"),
            documentId: d.id,
            speakerName:
              typeof mapped === "string" && mapped
                ? mapped
                : `Speaker ${r.speaker}`,
            startSeconds: r.startSeconds,
          },
        ];
      }),
    };
  };

  const searchTasks = async (): Promise<SearchGroup> => {
    const where = {
      AND: [...accessOpt],
      OR: [{ title: ci }, { description: ci }],
    };
    const [rows, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          matter: { select: { id: true, name: true } },
          lead: { select: { id: true, name: true } },
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
        // Firm-wide tasks (no matter) have no page that lists them
        // (the dashboard card shows only the viewer's own open
        // tasks), so the hit is rendered unlinked.
        // Intake tasks link to the lead's Tasks tab.
        href: t.matter
          ? `/matters/${t.matter.id}/tasks`
          : t.lead
            ? `/intake/${t.lead.id}/tasks`
            : null,
        context:
          t.matter?.name ?? (t.lead ? `Intake · ${t.lead.name}` : "Firm-wide"),
      })),
    };
  };

  const searchDeadlines = async (): Promise<SearchGroup> => {
    const where = { ...accessRel, OR: [{ title: ci }, { description: ci }] };
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
      where: {
        AND: [...accessOpt],
        OR: [{ title: ci }, { description: ci }, { location: ci }],
      },
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
        lead: { select: { name: true } },
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
        context:
          e.matter?.name ?? (e.lead ? `Intake · ${e.lead.name}` : null),
      })),
    };
  };

  const searchEmail = async (): Promise<SearchGroup> => {
    // Thread-level hits: subject + stored snippet + any message
    // body. The matched message is fetched alongside (filtered
    // include, newest first) so the snippet can quote the actual
    // matching body when subject/snippet didn't match.
    // Mailboxes are personal: scope to the viewer's own threads via
    // the shared read-model helper. The same `where` feeds findMany
    // AND count, so neither hits nor the total leak other mailboxes.
    // Bodies are sanitized HTML, matched raw in SQL (so a query like
    // "center" or "color" also hits markup such as text-align:center).
    // Each thread is therefore verified against the tag-stripped
    // text of its matching messages and dropped when only markup
    // matched; `total` is the SQL count minus those dropped rows.
    const emailLeadWall = await leadAccessWhere(viewerId);
    const bodyMatch = { OR: ciHtml.map((c) => ({ body: c })) };
    const where = {
      AND: [
        visibleEmailThreadWhere(viewerId),
        // Lead wall: a thread filed to a restricted lead is not searchable.
        // (Hidden-matter threads stay hits with the name withheld, below.)
        ...(Object.keys(emailLeadWall).length === 0
          ? []
          : [{ OR: [{ leadId: null }, { lead: emailLeadWall }] }]),
        {
          OR: [
            { subject: ci },
            { snippet: ci },
            { messages: { some: bodyMatch } },
          ],
        },
      ],
    };
    const total = await prisma.emailThread.count({ where });
    const hits: SearchHit[] = [];
    let markupOnly = 0;
    // Matter names on a thread filed to a hidden matter are withheld.
    // Page through candidate threads (newest first, stable order)
    // until `take` verified hits, bounded like the notes scan so a
    // markup-only query ("style", "center") can't become a full
    // mailbox read.
    for (let page = 0; page < NOTE_SCAN_MAX_PAGES; page++) {
      const rows = await prisma.emailThread.findMany({
        where,
        select: {
          id: true,
          subject: true,
          snippet: true,
          matterId: true,
          matter: { select: { name: true } },
          messages: {
            where: bodyMatch,
            orderBy: [{ sentAt: "desc" }, { id: "desc" }],
            take: EMAIL_BODY_CANDIDATES,
            select: { body: true },
          },
        },
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        skip: page * EMAIL_SCAN_PAGE,
        take: EMAIL_SCAN_PAGE,
      });
      const visibleMatters = await filterAccessibleMatterIds(
        viewerId,
        rows.flatMap((r) => (r.matterId ? [r.matterId] : []))
      );
      for (const t of rows) {
        if (hits.length >= take) break;
        const snippetCol = makeSnippet(t.snippet, q);
        const subjectHit = t.subject.toLowerCase().includes(qLower);
        let bodySnippet: string | null = null;
        if (!subjectHit && !snippetCol) {
          const scan = (msgs: Array<{ body: string }>) => {
            for (const m of msgs) {
              const found = makeSnippet(stripHtmlTags(m.body), q);
              if (found) return found;
            }
            return null;
          };
          bodySnippet = scan(t.messages);
          // The newest matching messages were all markup-only (an HTML
          // signature/table). Walk further back, bounded, so an older
          // real match still surfaces.
          let skip = t.messages.length;
          let more = t.messages.length >= EMAIL_BODY_CANDIDATES;
          for (
            let extra = 0;
            !bodySnippet && more && extra < EMAIL_BODY_MAX_EXTRA_PAGES;
            extra++
          ) {
            const older = await prisma.emailMessage.findMany({
              where: { threadId: t.id, ...bodyMatch },
              orderBy: [{ sentAt: "desc" }, { id: "desc" }],
              skip,
              take: EMAIL_BODY_CANDIDATES,
              select: { body: true },
            });
            bodySnippet = scan(older);
            skip += older.length;
            more = older.length >= EMAIL_BODY_CANDIDATES;
          }
        }
        if (!subjectHit && !snippetCol && !bodySnippet) {
          markupOnly++; // only markup / entity-encoding matched
          continue;
        }
        hits.push({
          type: "email",
          id: t.id,
          title: t.subject || "(no subject)",
          snippet: snippetCol ?? bodySnippet,
          href: `/communication?view=email&thread=${t.id}`,
          context:
            t.matterId && !visibleMatters.has(t.matterId)
              ? null
              : (t.matter?.name ?? null),
        });
      }
      if (hits.length >= take || rows.length < EMAIL_SCAN_PAGE) break;
    }
    return {
      type: "email",
      total: Math.max(total - markupOnly, hits.length),
      hits,
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
    // Effective matter = item override ?? thread default; items
    // resolving to a hidden matter are dropped.
    const where = {
      AND: [
        ...(Object.keys(accessMatter).length === 0
          ? []
          : [
              {
                OR: [
                  { matterId: null, thread: { defaultMatterId: null } },
                  { matter: accessMatter },
                  { matterId: null, thread: { defaultMatter: accessMatter } },
                ],
              },
            ]),
      ],
      OR: [{ body: ci }, { transcript: ci }],
    };
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
    // Matter access gates the entry (hidden matters never match).
    // For entries the viewer can reach, a privileged narrative is
    // searchable and quotable like any other (the Time tabs show it
    // to the same people).
    const where = {
      AND: [...accessOpt],
      OR: [{ activity: ci }, { narrative: ci }],
    };
    const [rows, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        select: {
          id: true,
          activity: true,
          narrative: true,
          matterId: true,
          matter: { select: { name: true } },
          // Lead-scoped (intake) entries have no matter — exactly one
          // of (matterId, leadId) is set. Pull the lead's name so the
          // hit still carries a human context line.
          leadId: true,
          lead: { select: { name: true } },
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
        return {
          type: "time",
          id: t.id,
          title: clip(t.activity),
          snippet:
            makeSnippet(t.activity, q) ??
            makeSnippet(t.narrative, q),
          // Intake entries route to the lead's Time tab; the
          // no-scope fallback (invariant breach) degrades to the
          // standalone /time page rather than a broken matter link.
          href: t.matterId
            ? `/matters/${t.matterId}/time`
            : t.leadId
              ? `/intake/${t.leadId}/time`
              : `/time`,
          context:
            t.matter?.name ??
            (t.lead ? `Intake · ${t.lead.name}` : "Intake"),
        };
      }),
    };
  };

  const searchRecordsRequests = async (): Promise<SearchGroup> => {
    // Gated on records.view; fee fields are never selected.
    if (!(await currentUserHasPermission("records.view"))) {
      return { type: "records_request", total: 0, hits: [] };
    }
    const where = {
      AND: [
        ...accessOpt,
        {
          OR: [
            { subject: ci },
            { description: ci },
            { custodian: { name: ci } },
          ],
        },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.recordsRequest.findMany({
        where,
        select: {
          id: true,
          subject: true,
          description: true,
          matterId: true,
          leadId: true,
          custodian: { select: { name: true } },
          matter: { select: { name: true } },
          lead: { select: { name: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take,
      }),
      prisma.recordsRequest.count({ where }),
    ]);
    return {
      type: "records_request",
      total,
      hits: rows.flatMap((r) => {
        let base: string;
        try {
          base = scopeBasePath(scopeOf(r));
        } catch (err) {
          console.warn("[search] skipping records request with no derivable scope", {
            id: r.id,
            err,
          });
          return [];
        }
        return [
          {
            type: "records_request" as const,
            id: r.id,
            title: r.subject,
            snippet:
              makeSnippet(r.subject, q) ??
              makeSnippet(r.description, q) ??
              makeSnippet(r.custodian.name, q),
            href: `${base}/records/${r.id}`,
            context:
              r.matter?.name ?? (r.lead ? `Intake \u00b7 ${r.lead.name}` : "Intake"),
          },
        ];
      }),
    };
  };

  const SEARCHERS: Record<SearchHitType, () => Promise<SearchGroup>> = {
    matter: searchMatters,
    contact: searchContacts,
    lead: searchLeads,
    note: searchNotes,
    document: searchDocuments,
    transcript: searchTranscripts,
    task: searchTasks,
    deadline: searchDeadlines,
    event: searchEvents,
    email: searchEmail,
    message: searchMessages,
    time: searchTime,
    records_request: searchRecordsRequests,
  };

  // Every enabled type is issued together (on the one-connection
  // production pool the statements still run back to back).
  const enabledTypes = SEARCH_HIT_TYPES.filter(
    (t) => !opts?.type || opts.type === t
  );
  const groups = await Promise.all(enabledTypes.map((t) => SEARCHERS[t]()));

  return {
    query: q,
    groups: groups.filter((g) => g.total > 0),
  };
}
