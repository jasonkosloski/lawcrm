/**
 * Integration tests for globalSearch — the /search page's query layer.
 *
 * What's pinned here, per the guards documented in search.ts:
 *
 *   - ILIKE matching per type + per-type take/total counts.
 *   - Calendar events run the SAME visibility resolver as the
 *     calendar grid: a stranger's private event never matches and
 *     its title never appears anywhere in the serialized result
 *     (leak test), while creator / show_details / matter-team paths
 *     all match.
 *   - Privileged time entries: the narrative is searchable and
 *     quoted for anyone who can access the matter (hidden matters
 *     are filtered out by matter access; see matter-access-reads).
 *   - Contacts: inactive + merged rows excluded.
 *   - Notes: raw-HTML match, but snippets/titles are tag-stripped
 *     and markup-only matches (e.g. inside an href) are dropped.
 *
 * Pure helpers (stripHtmlTags / makeSnippet) are unit-tested at the
 * top — same file since one test file per source is the convention.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  escapeLike,
  globalSearch,
  isSearchHitType,
  makeSnippet,
  SEARCH_GROUP_TAKE,
  stripHtmlTags,
  type GlobalSearchResult,
  type SearchHitType,
} from "@/lib/queries/search";
import {
  SNIPPET_MARK_END,
  SNIPPET_MARK_START,
} from "@/components/search/snippet";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
const mockedGetUser = vi.mocked(getCurrentUserId);

const marked = (s: string) => `${SNIPPET_MARK_START}${s}${SNIPPET_MARK_END}`;

const groupOf = (res: GlobalSearchResult, type: SearchHitType) =>
  res.groups.find((g) => g.type === type);

let viewerId: string;
let otherId: string;
let matterId: string; // viewer is on this matter's team (lead)
let otherMatterId: string; // viewer NOT on this matter's team
let areaId: string;
let stageId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId: viewerId } = await seedUser({ firmId, name: "Viewer V." }));
  ({ userId: otherId } = await seedUser({ firmId, name: "Other O." }));
  ({ areaId, stageId } = await seedPracticeArea());
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: viewerId,
    name: "Alvarez v. City of Aurora",
  }));
  ({ matterId: otherMatterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: otherId,
    name: "Unrelated v. Case",
  }));
  mockedGetUser.mockResolvedValue(viewerId);
});

// ── Pure helpers ────────────────────────────────────────────────────────

describe("stripHtmlTags", () => {
  test("strips tags, decodes entities, collapses whitespace", () => {
    expect(
      stripHtmlTags("<p>Tom &amp; Jerry</p>\n<p>saw the&nbsp;<strong>report</strong></p>")
    ).toBe("Tom & Jerry saw the report");
  });

  test("empty input stays empty", () => {
    expect(stripHtmlTags("")).toBe("");
  });
});

describe("makeSnippet", () => {
  test("null when the text doesn't contain the query (or is null)", () => {
    expect(makeSnippet("no relation", "ambulance")).toBeNull();
    expect(makeSnippet(null, "ambulance")).toBeNull();
  });

  test("marks the match case-insensitively, preserving original casing", () => {
    expect(makeSnippet("The Ambulance report", "ambulance")).toBe(
      `The ${marked("Ambulance")} report`
    );
  });

  test("clips to ±60 chars with ellipses on truncated sides only", () => {
    const text = "a".repeat(100) + " ambulance " + "b".repeat(100);
    const snippet = makeSnippet(text, "ambulance")!;
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain(marked("ambulance"));
    // ±60 window + match + markers + ellipses — nothing runaway.
    expect(snippet.length).toBeLessThanOrEqual(60 + 60 + "ambulance".length + 4);
  });

  test("no leading ellipsis when the match sits near the start", () => {
    expect(makeSnippet("ambulance up front", "ambulance")).toBe(
      `${marked("ambulance")} up front`
    );
  });
});

describe("isSearchHitType", () => {
  test("accepts known types, rejects junk", () => {
    expect(isSearchHitType("matter")).toBe(true);
    expect(isSearchHitType("event")).toBe(true);
    expect(isSearchHitType("users")).toBe(false);
    expect(isSearchHitType(undefined)).toBe(false);
  });
});

// ── Query guard ─────────────────────────────────────────────────────────

describe("globalSearch — minimum query length", () => {
  test("queries under 2 chars (incl. whitespace padding) return no groups", async () => {
    expect((await globalSearch("a")).groups).toEqual([]);
    expect((await globalSearch("  x  ")).groups).toEqual([]);
    expect((await globalSearch("")).groups).toEqual([]);
  });
});

// ── Per-entity coverage ─────────────────────────────────────────────────

describe("globalSearch — matters", () => {
  test("matches name and description; description match gets a marked snippet", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { description: "Excessive force; the ambulance report is key." },
    });
    const res = await globalSearch("ambulance");
    const g = groupOf(res, "matter")!;
    expect(g.total).toBe(1);
    expect(g.hits[0]).toMatchObject({
      type: "matter",
      id: matterId,
      title: "Alvarez v. City of Aurora",
      href: `/matters/${matterId}`,
    });
    expect(g.hits[0].snippet).toContain(marked("ambulance"));
  });

  test("archived matters remain searchable (retrieval surface, unlike the palette)", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { isArchived: true },
    });
    const res = await globalSearch("Alvarez");
    expect(groupOf(res, "matter")?.hits.map((h) => h.id)).toContain(matterId);
  });
});

describe("globalSearch — contacts", () => {
  test("matches email; excludes inactive and merged contacts", async () => {
    const { contactId } = await seedContact({
      name: "Maria Gonzales",
      email: "maria@ambulanceco.test",
      organization: "AmbulanceCo",
    });
    const { contactId: inactiveId } = await seedContact({
      name: "Old Ambulance Contact",
      isActive: false,
    });
    const { contactId: mergedId } = await seedContact({
      name: "Dup Ambulance Contact",
    });
    await prisma.contact.update({
      where: { id: mergedId },
      data: { mergedIntoId: contactId },
    });

    const res = await globalSearch("ambulance");
    const g = groupOf(res, "contact")!;
    const ids = g.hits.map((h) => h.id);
    expect(ids).toContain(contactId);
    expect(ids).not.toContain(inactiveId);
    expect(ids).not.toContain(mergedId);
    expect(g.total).toBe(1);
    const hit = g.hits.find((h) => h.id === contactId)!;
    expect(hit.href).toBe(`/contacts/${contactId}`);
    expect(hit.snippet).toContain(marked("ambulance"));
  });
});

describe("globalSearch — leads", () => {
  test("matches summary text and deep-links to the intake detail page", async () => {
    const { leadId } = await seedLead({ name: "Prospect P." });
    await prisma.lead.update({
      where: { id: leadId },
      data: { summary: "Rear-ended; ambulance transported to Denver Health." },
    });
    const res = await globalSearch("ambulance");
    const g = groupOf(res, "lead")!;
    expect(g.hits[0]).toMatchObject({
      id: leadId,
      title: "Prospect P.",
      href: `/intake/${leadId}`,
    });
    expect(g.hits[0].snippet).toContain(marked("ambulance"));
  });
});

describe("globalSearch — notes", () => {
  test("matches sanitized-HTML bodies; snippet + title are tag-stripped", async () => {
    const note = await prisma.note.create({
      data: {
        matterId,
        authorId: viewerId,
        content:
          "<p>Client called about the <strong>ambulance</strong> report from APD.</p>",
      },
      select: { id: true },
    });
    const res = await globalSearch("ambulance");
    const g = groupOf(res, "note")!;
    const hit = g.hits.find((h) => h.id === note.id)!;
    expect(hit.href).toBe(`/matters/${matterId}/notes`);
    expect(hit.context).toBe("Alvarez v. City of Aurora");
    expect(hit.snippet).toContain(marked("ambulance"));
    // Tag-stripped: no markup survives into title or snippet.
    expect(hit.snippet).not.toContain("<");
    expect(hit.title).not.toContain("<");
    expect(hit.title).toContain("ambulance report");
  });

  test("markup-only matches (query inside an href) are dropped from hits", async () => {
    await prisma.note.create({
      data: {
        matterId,
        authorId: viewerId,
        content: '<p>see <a href="https://ambulance.test/x">the link</a></p>',
      },
    });
    const res = await globalSearch("ambulance");
    expect(groupOf(res, "note")?.hits ?? []).toEqual([]);
  });
});

describe("globalSearch — documents", () => {
  test("matches name (schema has no description column) with matter context", async () => {
    const doc = await prisma.document.create({
      data: { matterId, name: "Ambulance run report.pdf" },
      select: { id: true },
    });
    const res = await globalSearch("ambulance");
    const g = groupOf(res, "document")!;
    expect(g.hits[0]).toMatchObject({
      id: doc.id,
      title: "Ambulance run report.pdf",
      // The viewer route: the Documents tab only lists one folder.
      href: `/matters/${matterId}/documents/${doc.id}`,
      context: "Alvarez v. City of Aurora",
    });
  });

  test("finds an intake lead's document with the lead viewer href and Intake context", async () => {
    const { leadId } = await seedLead({ name: "Test Lead" });
    const doc = await prisma.document.create({
      data: { leadId, name: "Zebrafoil retainer draft.pdf" },
      select: { id: true },
    });
    const res = await globalSearch("zebrafoil");
    const g = groupOf(res, "document")!;
    expect(g.hits[0]).toMatchObject({
      id: doc.id,
      href: `/intake/${leadId}/documents/${doc.id}`,
      context: "Intake · Test Lead",
    });
  });

  test("TEAM mode: a restricted viewer still finds lead documents but not a hidden matter's", async () => {
    await prisma.firm.updateMany({ data: { matterVisibility: "TEAM" } });
    const { leadId } = await seedLead({ name: "Test Lead" });
    const leadDoc = await prisma.document.create({
      data: { leadId, name: "Quokkaprint intake form.pdf" },
      select: { id: true },
    });
    await prisma.document.create({
      data: { matterId: otherMatterId, name: "Quokkaprint secret.pdf" },
    });
    const g = groupOf(await globalSearch("quokkaprint"), "document")!;
    expect(g.total).toBe(1);
    expect(g.hits).toHaveLength(1);
    expect(g.hits[0]).toMatchObject({
      id: leadDoc.id,
      href: `/intake/${leadId}/documents/${leadDoc.id}`,
      context: "Intake · Test Lead",
    });
  });
});

describe("globalSearch — tasks", () => {
  test("matter tasks deep-link to the matter's tasks tab; firm-wide tasks are unlinked", async () => {
    const matterTask = await prisma.task.create({
      data: { matterId, title: "Subpoena the ambulance records" },
      select: { id: true },
    });
    const firmTask = await prisma.task.create({
      data: { title: "Order ambulance-chaser mugs" },
      select: { id: true },
    });
    const res = await globalSearch("ambulance");
    const g = groupOf(res, "task")!;
    expect(g.total).toBe(2);
    const m = g.hits.find((h) => h.id === matterTask.id)!;
    const f = g.hits.find((h) => h.id === firmTask.id)!;
    expect(m.href).toBe(`/matters/${matterId}/tasks`);
    expect(f.href).toBeNull();
    expect(f.context).toBe("Firm-wide");
  });
});

describe("globalSearch — deadlines", () => {
  test("matches title/description and links to the deadlines tab", async () => {
    const d = await prisma.deadline.create({
      data: {
        matterId,
        title: "Discovery cutoff",
        description: "Includes the ambulance run sheet production.",
        dueDate: new Date("2026-09-01T00:00:00Z"),
      },
      select: { id: true },
    });
    const res = await globalSearch("ambulance");
    const g = groupOf(res, "deadline")!;
    expect(g.hits[0]).toMatchObject({
      id: d.id,
      title: "Discovery cutoff",
      href: `/matters/${matterId}/deadlines`,
    });
    expect(g.hits[0].snippet).toContain(marked("ambulance"));
  });
});

describe("globalSearch — calendar events (visibility scrub)", () => {
  const seedEvent = (data: {
    title: string;
    createdById: string;
    visibility?: string;
    matterId?: string | null;
    description?: string;
  }) =>
    prisma.calendarEvent.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        createdById: data.createdById,
        visibility: data.visibility ?? "default",
        matterId: data.matterId ?? null,
        startTime: new Date("2026-07-10T15:00:00Z"),
        endTime: new Date("2026-07-10T16:00:00Z"),
      },
      select: { id: true },
    });

  test("viewer's own private event matches", async () => {
    const e = await seedEvent({
      title: "Ambulance vendor call",
      createdById: viewerId,
    });
    const res = await globalSearch("ambulance");
    expect(groupOf(res, "event")?.hits.map((h) => h.id)).toContain(e.id);
  });

  test("a stranger's private event NEVER matches and its text never leaks", async () => {
    await seedEvent({
      title: "Ambulance settlement strategy (secret)",
      description: "Confidential ambulance discussion",
      createdById: otherId,
      matterId: otherMatterId, // viewer is not on this matter's team
    });
    const res = await globalSearch("ambulance");
    expect(groupOf(res, "event")).toBeUndefined();
    // Belt-and-braces: the private title must not appear anywhere in
    // the serialized result — not as a snippet, context, or count
    // side-channel of some other group.
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  test("show_details override makes another user's event searchable", async () => {
    const e = await seedEvent({
      title: "Firm ambulance CLE",
      createdById: otherId,
      visibility: "show_details",
    });
    const res = await globalSearch("ambulance");
    expect(groupOf(res, "event")?.hits.map((h) => h.id)).toContain(e.id);
  });

  test("matter-team membership grants the match (same resolver as the calendar)", async () => {
    const e = await seedEvent({
      title: "Ambulance driver deposition",
      createdById: otherId,
      matterId, // viewer leads this matter
    });
    const res = await globalSearch("ambulance");
    const hit = groupOf(res, "event")?.hits.find((h) => h.id === e.id);
    expect(hit).toBeDefined();
    expect(hit!.href).toBe(`/calendar?event=${e.id}`);
    expect(hit!.context).toBe("Alvarez v. City of Aurora");
  });
});

describe("globalSearch — email", () => {
  async function seedThread(subject: string, body: string) {
    const account = await prisma.emailAccount.create({
      data: { userId: viewerId, emailAddress: "inbox@firm.test" },
      select: { id: true },
    });
    return prisma.emailThread.create({
      data: {
        accountId: account.id,
        subject,
        matterId,
        lastMessageAt: new Date("2026-07-01T12:00:00Z"),
        messages: {
          create: {
            fromName: "Opposing Counsel",
            fromEmail: "oc@defense.test",
            toRecipients: "[]",
            body,
            sentAt: new Date("2026-07-01T12:00:00Z"),
          },
        },
      },
      select: { id: true },
    });
  }

  test("matches a message body; snippet quotes the stripped body", async () => {
    const t = await seedThread(
      "RE: Discovery",
      "Please find the <b>ambulance</b> run report attached."
    );
    const res = await globalSearch("ambulance");
    const g = groupOf(res, "email")!;
    const hit = g.hits.find((h) => h.id === t.id)!;
    expect(hit.title).toBe("RE: Discovery");
    expect(hit.href).toBe(`/communication?view=email&thread=${t.id}`);
    expect(hit.context).toBe("Alvarez v. City of Aurora");
    expect(hit.snippet).toContain(marked("ambulance"));
    expect(hit.snippet).not.toContain("<b>");
  });

  test("matches the subject line too", async () => {
    const t = await seedThread("Ambulance records subpoena", "unrelated body");
    const res = await globalSearch("ambulance");
    expect(groupOf(res, "email")?.hits.map((h) => h.id)).toContain(t.id);
  });
});

describe("globalSearch — messenger", () => {
  test("matches a voicemail transcript and links to its thread", async () => {
    const account = await prisma.messengerAccount.create({
      data: { provider: "manual", phoneNumber: "+13035550100" },
      select: { id: true },
    });
    const thread = await prisma.messengerThread.create({
      data: {
        accountId: account.id,
        contactPhone: "+13035550199",
        defaultMatterId: matterId,
        lastItemAt: new Date("2026-07-01T12:00:00Z"),
      },
      select: { id: true },
    });
    const item = await prisma.messengerItem.create({
      data: {
        threadId: thread.id,
        providerEventId: "evt-vm-1",
        kind: "voicemail",
        direction: "inbound",
        fromNumber: "+13035550199",
        toNumber: "+13035550100",
        transcript: "Hi, calling about the ambulance bill from the crash.",
        occurredAt: new Date("2026-07-01T12:00:00Z"),
      },
      select: { id: true },
    });
    const res = await globalSearch("ambulance");
    const g = groupOf(res, "message")!;
    const hit = g.hits.find((h) => h.id === item.id)!;
    expect(hit.title).toMatch(/^Voicemail · /);
    expect(hit.href).toBe(`/communication?view=messages&thread=${thread.id}`);
    expect(hit.context).toBe("Alvarez v. City of Aurora");
    expect(hit.snippet).toContain(marked("ambulance"));
  });
});

describe("globalSearch — time entries (privileged narrative)", () => {
  const seedEntry = (opts: {
    userId: string;
    activity: string;
    narrative?: string | null;
    privileged?: boolean;
  }) =>
    prisma.timeEntry.create({
      data: {
        matterId,
        userId: opts.userId,
        date: new Date("2026-06-30T00:00:00Z"),
        hours: 1,
        activity: opts.activity,
        narrative: opts.narrative ?? null,
        privileged: opts.privileged ?? false,
      },
      select: { id: true },
    });

  test("a colleague's PRIVILEGED narrative is searchable and quoted for anyone who can access the matter", async () => {
    const e = await seedEntry({
      userId: otherId,
      activity: "Strategy call",
      narrative: "Privileged: discussed the ambulance report weakness.",
      privileged: true,
    });
    const res = await globalSearch("ambulance");
    const hit = groupOf(res, "time")?.hits.find((h) => h.id === e.id);
    expect(hit).toBeDefined();
    expect(hit!.snippet).toContain(marked("ambulance"));
  });

  test("the author finds their own privileged narrative", async () => {
    const e = await seedEntry({
      userId: viewerId,
      activity: "Strategy call",
      narrative: "Privileged: discussed the ambulance report.",
      privileged: true,
    });
    const res = await globalSearch("ambulance");
    const hit = groupOf(res, "time")?.hits.find((h) => h.id === e.id);
    expect(hit).toBeDefined();
    expect(hit!.snippet).toContain(marked("ambulance"));
    expect(hit!.href).toBe(`/matters/${matterId}/time`);
  });

  test("non-privileged narratives match for everyone", async () => {
    const e = await seedEntry({
      userId: otherId,
      activity: "Records review",
      narrative: "Reviewed ambulance run sheet.",
    });
    const res = await globalSearch("ambulance");
    expect(groupOf(res, "time")?.hits.map((h) => h.id)).toContain(e.id);
  });
});

// ── Grouping / counts / type filter ─────────────────────────────────────

describe("globalSearch — take, totals, and ?type= expansion", () => {
  test("caps hits at SEARCH_GROUP_TAKE while total reports the real count", async () => {
    for (let i = 0; i < 12; i++) {
      await seedMatter({
        practiceAreaId: areaId,
        stageId,
        leadUserId: viewerId,
        name: `Chemical spill claim ${i}`,
      });
    }
    const res = await globalSearch("chemical");
    const g = groupOf(res, "matter")!;
    expect(g.hits).toHaveLength(SEARCH_GROUP_TAKE);
    expect(g.total).toBe(12);
  });

  test("type filter runs only that type and lifts the cap", async () => {
    for (let i = 0; i < 12; i++) {
      await seedMatter({
        practiceAreaId: areaId,
        stageId,
        leadUserId: viewerId,
        name: `Chemical spill claim ${i}`,
      });
    }
    await prisma.task.create({
      data: { matterId, title: "Chemical analysis follow-up" },
    });
    const res = await globalSearch("chemical", { type: "matter" });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].type).toBe("matter");
    expect(res.groups[0].hits).toHaveLength(12);
  });

  test("empty groups are omitted entirely", async () => {
    await prisma.task.create({
      data: { matterId, title: "Order the widget report" },
    });
    const res = await globalSearch("widget");
    expect(res.groups.map((g) => g.type)).toEqual(["task"]);
  });
});

describe("globalSearch — email mailbox privacy", () => {
  /** A thread on `ownerId`'s own mailbox whose subject, snippet and
   *  body all contain the needle. Filed to the shared matter so a
   *  "filed threads are firm-visible" regression would show up too. */
  async function seedOwnedThread(ownerId: string, tag: string) {
    const account = await prisma.emailAccount.create({
      data: { userId: ownerId, emailAddress: `${tag}@firm.test` },
      select: { id: true },
    });
    return prisma.emailThread.create({
      data: {
        accountId: account.id,
        subject: `Needle subject ${tag}`,
        snippet: `Needle snippet ${tag}`,
        matterId,
        lastMessageAt: new Date("2026-07-01T12:00:00Z"),
        messages: {
          create: {
            fromName: "Client",
            fromEmail: "client@example.test",
            toRecipients: "[]",
            body: `Needle body text ${tag}`,
            sentAt: new Date("2026-07-01T12:00:00Z"),
          },
        },
      },
      select: { id: true },
    });
  }

  test("user B never sees user A's threads - hits, total or serialized result", async () => {
    const a = await seedOwnedThread(otherId, "alpha-private");
    const mine = await seedOwnedThread(viewerId, "bravo-mine");

    const res = await globalSearch("needle");
    const g = groupOf(res, "email")!;
    expect(g.hits.map((h) => h.id)).toEqual([mine.id]);
    expect(g.total).toBe(1);
    expect(g.hits.map((h) => h.id)).not.toContain(a.id);

    const json = JSON.stringify(res);
    expect(json).not.toContain("alpha-private");
    expect(json).toContain("bravo-mine");

    // Same query as the other user flips the picture.
    mockedGetUser.mockResolvedValue(otherId);
    const asOwner = groupOf(await globalSearch("needle"), "email")!;
    expect(asOwner.hits.map((h) => h.id)).toEqual([a.id]);
    expect(asOwner.total).toBe(1);
  });

  test("a body-only match on another mailbox leaks neither body nor group", async () => {
    const account = await prisma.emailAccount.create({
      data: { userId: otherId, emailAddress: "other@firm.test" },
      select: { id: true },
    });
    await prisma.emailThread.create({
      data: {
        accountId: account.id,
        subject: "Quarterly update",
        lastMessageAt: new Date("2026-07-01T12:00:00Z"),
        messages: {
          create: {
            fromName: "Partner",
            fromEmail: "p@firm.test",
            toRecipients: "[]",
            body: "settlement authority is $250k",
            sentAt: new Date("2026-07-01T12:00:00Z"),
          },
        },
      },
    });
    const res = await globalSearch("authority");
    const json = JSON.stringify(res);
    expect(json).not.toContain("Quarterly update");
    expect(json).not.toContain("250k");
    expect(groupOf(res, "email")?.total ?? 0).toBe(0);
  });
});

// NOTE: the tests below assert the escaped value handed to Prisma plus
// the DB-backed "literal %, _" cases; that Prisma 7's pg adapter does
// not escape LIKE metacharacters itself was verified manually against a
// real database. If a Prisma upgrade starts escaping internally, the
// "wildcards match literally" suite below will fail (double-escape).
describe("escapeLike", () => {
  test("escapes %, _ and backslash", () => {
    expect(escapeLike("50%_x\\")).toBe("50\\%\\_x\\\\");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("globalSearch — LIKE wildcards match literally", () => {
  test("'__' and '%%' do not enumerate every row", async () => {
    // seeded matters already exist; neither contains an underscore/percent
    expect(await globalSearch("__")).toMatchObject({ groups: [] });
    expect(await globalSearch("%%")).toMatchObject({ groups: [] });
  });

  test("a literal percent matches only text containing it", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { description: "Contingency fee of 33% plus costs" },
    });
    await prisma.matter.update({
      where: { id: otherMatterId },
      data: { description: "Settled for 3300 dollars" },
    });
    const g = groupOf(await globalSearch("33%"), "matter")!;
    expect(g.total).toBe(1);
    expect(g.hits[0].id).toBe(matterId);
    expect(g.hits[0].snippet).toContain(marked("33%"));
  });

  test("an underscore is literal and a trailing backslash does not throw", async () => {
    await prisma.task.create({ data: { title: "file_number cleanup" } });
    await prisma.task.create({ data: { title: "fileXnumber cleanup" } });
    const g = groupOf(await globalSearch("file_number"), "task")!;
    expect(g.total).toBe(1);
    await expect(globalSearch("abc\\")).resolves.toMatchObject({ groups: [] });
  });
});

describe("globalSearch — matter lookup fields", () => {
  test("finds a matter by docket number, court and opposing party/firm (archived too)", async () => {
    await prisma.matter.update({
      where: { id: otherMatterId },
      data: {
        caseNumber: "2026-CV-00481",
        court: "Denver District Court",
        opposingParty: "Zenith Holdings",
        opposingFirm: "Brightwater LLP",
        isArchived: true,
      },
    });
    for (const needle of [
      "2026-CV-00481",
      "denver district",
      "zenith",
      "brightwater",
    ]) {
      const g = groupOf(await globalSearch(needle), "matter")!;
      expect(g.hits.map((h) => h.id), needle).toEqual([otherMatterId]);
      expect(g.hits[0].snippet, needle).toContain(SNIPPET_MARK_START);
    }
  });
});

describe("globalSearch — markup-only matches do not crowd out real hits", () => {
  test("old real notes still surface past 30 newer notes that only match markup", async () => {
    const real = await prisma.note.create({
      data: {
        matterId,
        authorId: viewerId,
        content: "<p>client has a strong excessive-force claim</p>",
        updatedAt: new Date("2025-01-01T00:00:00Z"),
      },
      select: { id: true },
    });
    await prisma.note.createMany({
      data: Array.from({ length: 45 }, (_, i) => ({
        matterId,
        authorId: viewerId,
        content: `<p><strong>bold ${i}</strong></p>`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    });
    const g = groupOf(await globalSearch("strong"), "note")!;
    expect(g.hits.map((h) => h.id)).toEqual([real.id]);
    // total excludes the markup-only rows that were scanned
    expect(g.total).toBe(1);
  });

  test("an entity-encoded ampersand in a note is findable", async () => {
    const note = await prisma.note.create({
      data: {
        matterId,
        authorId: viewerId,
        content: "<p>Smith &amp; Wesson revolver recovered</p>",
      },
      select: { id: true },
    });
    const g = groupOf(await globalSearch("Smith & Wesson"), "note")!;
    expect(g.hits.map((h) => h.id)).toEqual([note.id]);
  });

  test("email whose only match is inline-style markup is dropped, not listed snippet-less", async () => {
    const account = await prisma.emailAccount.create({
      data: { userId: viewerId, emailAddress: "inbox2@firm.test" },
      select: { id: true },
    });
    const mk = (subject: string, body: string) =>
      prisma.emailThread.create({
        data: {
          accountId: account.id,
          subject,
          lastMessageAt: new Date("2026-07-01T12:00:00Z"),
          messages: {
            create: {
              fromName: "X",
              fromEmail: "x@example.test",
              toRecipients: "[]",
              body,
              sentAt: new Date("2026-07-01T12:00:00Z"),
            },
          },
        },
        select: { id: true },
      });
    await mk("Newsletter", '<p style="text-align:center">Hello there</p>');
    const real = await mk(
      "Records",
      "<p>Transferred to the medical center downtown</p>"
    );
    const g = groupOf(await globalSearch("center"), "email")!;
    expect(g.hits.map((h) => h.id)).toEqual([real.id]);
    expect(g.total).toBe(1);
    expect(g.hits[0].snippet).toContain(marked("center"));
  });

  test("email paging: more than `take` newer markup-only threads do not hide an older real hit", async () => {
    const account = await prisma.emailAccount.create({
      data: { userId: viewerId, emailAddress: "inbox3@firm.test" },
      select: { id: true },
    });
    const mk = (subject: string, body: string, at: Date) =>
      prisma.emailThread.create({
        data: {
          accountId: account.id,
          subject,
          lastMessageAt: at,
          messages: {
            create: {
              fromName: "X",
              fromEmail: "x@example.test",
              toRecipients: "[]",
              body,
              sentAt: at,
            },
          },
        },
        select: { id: true },
      });
    const real = await mk(
      "Records",
      "<p>Transferred to the medical center downtown</p>",
      new Date("2025-01-01T00:00:00Z")
    );
    // More than SEARCH_GROUP_TAKE (and more than one 50-thread page).
    for (let i = 0; i < 55; i++) {
      await mk(
        `Newsletter ${i}`,
        '<p style="text-align:center">Hello there</p>',
        new Date(Date.UTC(2026, 0, 1, 0, i))
      );
    }
    const g = groupOf(await globalSearch("center"), "email")!;
    expect(g.hits.map((h) => h.id)).toEqual([real.id]);
    expect(g.total).toBe(1);
  });

  test("email message window: older real match behind several markup-only messages still surfaces", async () => {
    const account = await prisma.emailAccount.create({
      data: { userId: viewerId, emailAddress: "inbox4@firm.test" },
      select: { id: true },
    });
    const thread = await prisma.emailThread.create({
      data: {
        accountId: account.id,
        subject: "Long thread",
        lastMessageAt: new Date("2026-07-10T00:00:00Z"),
      },
      select: { id: true },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        fromName: "X",
        fromEmail: "x@example.test",
        toRecipients: "[]",
        body: "<p>Meet at the medical center</p>",
        sentAt: new Date("2026-07-01T00:00:00Z"),
      },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          fromName: "X",
          fromEmail: "x@example.test",
          toRecipients: "[]",
          body: `<p style="text-align:center">sig ${i}</p>`,
          sentAt: new Date(Date.UTC(2026, 6, 5 + i)),
        },
      });
    }
    const g = groupOf(await globalSearch("center"), "email")!;
    expect(g.hits.map((h) => h.id)).toEqual([thread.id]);
    expect(g.hits[0].snippet).toContain(marked("center"));
  });
});
