/**
 * Conflict-check matcher.
 *
 * Given a candidate (typically a lead's name + email + organization),
 * scan the firm's existing Contacts and matter opposing-side records
 * for matches that would create a conflict of interest.
 *
 * Severity tiers:
 *   - "conflict" (hard): same email AND we have a record of this
 *     email being on the opposing side of an active matter, OR an
 *     exact (case-insensitive) name match against a non-client
 *     party on an active matter. These are bright-line ethical
 *     violations under most state Rules of Professional Conduct
 *     (e.g. ABA Model Rule 1.7).
 *   - "warn" (soft): name appears as a contact already (either
 *     side of any matter), or organization match. Worth a beat to
 *     verify identity before taking on the matter.
 *   - "clear": no matches.
 *
 * The matcher is read-only and pure — the action layer wraps it
 * with persistence and audit logging.
 *
 * Matching runs in Postgres with `mode: "insensitive"` equality —
 * every row is considered, with NO arbitrary row cap. (An earlier
 * revision pulled a bounded candidate slice and re-filtered in JS,
 * which silently missed conflicts once a table outgrew the cap —
 * the worst possible failure mode for an ethics check.) Candidate
 * values are pre-normalized via normalize() (trim + collapse
 * whitespace), so candidate-side sloppiness can't miss a match;
 * stored values are compared as-entered, so a stored record with
 * irregular *internal* whitespace won't hit. Acceptable trade:
 * that requires shadow normalized columns to fix, and it fails
 * loud-ish (a near-miss) rather than silently dropping true
 * matches past a row limit.
 */

import { prisma } from "@/lib/prisma";

export type ConflictMatchKind =
  | "contact_email"
  | "contact_name"
  | "matter_opposing_party"
  | "matter_opposing_firm"
  /** A contact someone manually flagged as a conflict
   *  (`Contact.conflictStatus = "flagged"`). Always hard. */
  | "contact_flagged"
  /** The ADVERSE party being screened is (or was) the firm's client —
   *  see `runAdverseConflictMatcher`. Hard on an active matter (Rule
   *  1.7), soft when every such matter is archived (Rule 1.9). */
  | "adverse_is_client";

export type ConflictMatch = {
  kind: ConflictMatchKind;
  severity: "conflict" | "warn";
  matchedField: "name" | "email" | "organization";
  description: string;
  contactId?: string;
  matterId?: string;
};

export type ConflictCheckResult = {
  severity: "clear" | "warn" | "conflict";
  matches: ConflictMatch[];
};

export type ConflictCandidate = {
  name: string | null;
  email: string | null;
  organization: string | null;
  /** The candidate's OWN Contact row (a lead's Lead.contactId). Every
   *  lead hangs off a Contact built from the same name / email /
   *  organization being scanned, so without this the lead matches
   *  itself and can never come back "clear". It is skipped only by the
   *  soft "already in the directory" warn paths. The hard tier still
   *  considers it: if the person is ALSO on the opposing side of an
   *  active matter, that is a real conflict, not a self-match. */
  ownContactId?: string | null;
};

/** Normalize for case-insensitive comparison. Lowercase + trim +
 *  collapse internal whitespace. Exported for testing — UI / DB
 *  callers should go through `runConflictMatcher`. */
export function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Roll up a list of matches into the overall severity label.
 *  Pure — kept exported so the matcher's decision can be unit-
 *  tested without the surrounding DB infrastructure. */
export function summarizeMatchSeverity(matches: ConflictMatch[]): ConflictCheckResult["severity"] {
  if (matches.some((m) => m.severity === "conflict")) return "conflict";
  if (matches.length > 0) return "warn";
  return "clear";
}

export async function runConflictMatcher(
  candidate: ConflictCandidate,
): Promise<ConflictCheckResult> {
  const nameKey = normalize(candidate.name);
  const emailKey = normalize(candidate.email);
  const orgKey = normalize(candidate.organization);
  const ownContactId = candidate.ownContactId ?? null;

  if (!nameKey && !emailKey && !orgKey) {
    return { severity: "clear", matches: [] };
  }

  const matches: ConflictMatch[] = [];
  const seenContactIds = new Set<string>();

  // ── Email match (hard signal when used in opposing-side roles) ─
  if (emailKey) {
    // Deactivated contacts are INCLUDED: deleting / bulk-deactivating a
    // contact only flips isActive and leaves its MatterContact rows on
    // active matters, so an inactive opposing party is still a party.
    // Contacts merged away are excluded (their rows moved to the
    // survivor, which matches in their place).
    const emailHits = await prisma.contact.findMany({
      where: {
        mergedIntoId: null,
        email: { equals: emailKey, mode: "insensitive" },
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        email: true,
        type: true,
        organization: true,
      },
    });
    // Opposing-side use is counted in two batched queries (not one
    // count per hit): the contact as a non-client party, and the
    // contact as someone's attorney (MatterContact.representationContactId
    // — opposing counsel is stored there, with no party row of their own).
    const hitIds = emailHits.map((c) => c.id);
    const [asParty, asCounsel] =
      hitIds.length === 0
        ? [[], []]
        : await Promise.all([
            prisma.matterContact.groupBy({
              by: ["contactId"],
              where: {
                contactId: { in: hitIds },
                NOT: { category: "client" },
                matter: { isArchived: false },
              },
              _count: { _all: true },
            }),
            prisma.matterContact.groupBy({
              by: ["representationContactId"],
              where: {
                representationContactId: { in: hitIds },
                NOT: { category: "client" },
                matter: { isArchived: false },
              },
              _count: { _all: true },
            }),
          ]);
    const useCounts = new Map<string, number>();
    for (const g of asParty) {
      useCounts.set(g.contactId, (useCounts.get(g.contactId) ?? 0) + g._count._all);
    }
    for (const g of asCounsel) {
      if (!g.representationContactId) continue;
      useCounts.set(
        g.representationContactId,
        (useCounts.get(g.representationContactId) ?? 0) + g._count._all,
      );
    }
    for (const c of emailHits) {
      // Hard tier requires the opposing-side use to be on an
      // ACTIVE matter (see header) — archived files only warn.
      const opposingSideUse = useCounts.get(c.id) ?? 0;
      seenContactIds.add(c.id);
      // The soft "already in the directory" warn never applies to the
      // candidate's own Contact. Deactivated contacts still warn,
      // labelled "(inactive)": a former client matters under Rule 1.9.
      if (opposingSideUse === 0 && c.id === ownContactId) {
        continue;
      }
      matches.push({
        kind: "contact_email",
        severity: opposingSideUse > 0 ? "conflict" : "warn",
        matchedField: "email",
        description:
          opposingSideUse > 0
            ? `${c.name} — same email; appears on opposing side of ${opposingSideUse} active matter${opposingSideUse === 1 ? "" : "s"}`
            : `${c.name}${c.isActive ? "" : " (inactive)"} — same email already in the firm's contact directory`,
        contactId: c.id,
      });
    }

    // Legacy free-text representation email (no Contact row): the same
    // person typed in as opposing counsel on a party.
    const legacyCounselByEmail = await prisma.matterContact.findMany({
      where: {
        NOT: { category: "client" },
        matter: { isArchived: false },
        representationEmail: { equals: emailKey, mode: "insensitive" },
      },
      select: {
        category: true,
        matter: { select: { id: true, name: true } },
        representationName: true,
      },
    });
    for (const mc of legacyCounselByEmail) {
      matches.push({
        kind: "contact_email",
        severity: "conflict",
        matchedField: "email",
        description: `${mc.representationName ?? "Opposing counsel"} — same email; opposing counsel for ${mc.category} on matter "${mc.matter.name}"`,
        matterId: mc.matter.id,
      });
    }
  }

  // ── Exact name match against opposing parties on matters ─────
  if (nameKey) {
    // Legacy free-text fields on Matter (opposingParty / opposingFirm).
    const matterCandidates = await prisma.matter.findMany({
      where: {
        isArchived: false,
        OR: [
          { opposingParty: { equals: nameKey, mode: "insensitive" } },
          { opposingFirm: { equals: nameKey, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        opposingParty: true,
        opposingFirm: true,
      },
    });
    for (const m of matterCandidates) {
      const partyKey = normalize(m.opposingParty);
      const firmKey = normalize(m.opposingFirm);
      if (partyKey && partyKey === nameKey) {
        matches.push({
          kind: "matter_opposing_party",
          severity: "conflict",
          matchedField: "name",
          description: `${m.name} — exact match against this matter's opposing party`,
          matterId: m.id,
        });
      } else if (firmKey && firmKey === nameKey) {
        matches.push({
          kind: "matter_opposing_firm",
          severity: "conflict",
          matchedField: "name",
          description: `${m.name} — exact match against this matter's opposing firm`,
          matterId: m.id,
        });
      }
    }

    // Structured MatterContact path — non-client roles (opposing
    // counsel, witness, etc.) joined to Contact.
    const partyCandidates = await prisma.matterContact.findMany({
      where: {
        NOT: { category: "client" },
        matter: { isArchived: false },
        // Includes deactivated contacts (still parties on the matter);
        // excludes contacts merged away (rows already moved).
        contact: {
          mergedIntoId: null,
          name: { equals: nameKey, mode: "insensitive" },
        },
      },
      select: {
        id: true,
        category: true,
        matter: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
      },
    });
    for (const mc of partyCandidates) {
      matches.push({
        kind: "matter_opposing_party",
        severity: "conflict",
        matchedField: "name",
        description: `${mc.contact.name} — appears as ${mc.category} on matter "${mc.matter.name}"`,
        matterId: mc.matter.id,
        contactId: mc.contact.id,
      });
      seenContactIds.add(mc.contact.id);
    }

    // Opposing counsel: the candidate may be the ATTORNEY on a party
    // row — linked as a Contact via representationContactId, or only
    // typed into the legacy representationName text.
    // Contacts already reported by the email / party paths are not
    // reported a second time as counsel (snapshot before this loop so
    // one contact on several matters still lists each matter).
    const reportedBeforeCounsel = new Set(seenContactIds);
    const counselCandidates = await prisma.matterContact.findMany({
      where: {
        NOT: { category: "client" },
        matter: { isArchived: false },
        OR: [
          {
            representationContact: {
              mergedIntoId: null,
              name: { equals: nameKey, mode: "insensitive" },
            },
          },
          { representationName: { equals: nameKey, mode: "insensitive" } },
        ],
      },
      select: {
        category: true,
        matter: { select: { id: true, name: true } },
        representationContact: { select: { id: true, name: true } },
        representationName: true,
      },
    });
    for (const mc of counselCandidates) {
      if (mc.representationContact && reportedBeforeCounsel.has(mc.representationContact.id)) {
        continue;
      }
      const counselName = mc.representationContact?.name ?? mc.representationName ?? nameKey;
      matches.push({
        kind: "matter_opposing_party",
        severity: "conflict",
        matchedField: "name",
        description: `${counselName} — opposing counsel for ${mc.category} on matter "${mc.matter.name}"`,
        matterId: mc.matter.id,
        contactId: mc.representationContact?.id,
      });
      if (mc.representationContact) {
        seenContactIds.add(mc.representationContact.id);
      }
    }

    // Soft signal: same name appears as any contact. Skip when
    // we already counted the contact via a higher-severity path.
    const nameCandidates = await prisma.contact.findMany({
      where: {
        mergedIntoId: null,
        name: { equals: nameKey, mode: "insensitive" },
      },
      select: { id: true, name: true, type: true, isActive: true },
    });
    for (const c of nameCandidates) {
      if (seenContactIds.has(c.id) || c.id === ownContactId) continue;
      matches.push({
        kind: "contact_name",
        severity: "warn",
        matchedField: "name",
        description: `${c.name}${c.isActive ? "" : " (inactive)"} — same name in the firm's contact directory (${c.type})`,
        contactId: c.id,
      });
      seenContactIds.add(c.id);
    }
  }

  // ── Organization soft match ──────────────────────────────────
  if (orgKey) {
    const orgCandidates = await prisma.contact.findMany({
      where: {
        mergedIntoId: null,
        organization: { equals: orgKey, mode: "insensitive" },
      },
      select: {
        id: true,
        name: true,
        organization: true,
        type: true,
        isActive: true,
      },
    });
    for (const c of orgCandidates) {
      if (seenContactIds.has(c.id) || c.id === ownContactId) continue;
      matches.push({
        kind: "contact_name",
        severity: "warn",
        matchedField: "organization",
        description: `${c.name}${c.isActive ? "" : " (inactive)"} (${c.organization}) — same organization`,
        contactId: c.id,
      });
      seenContactIds.add(c.id);
    }
  }

  // ── Manually flagged contacts (hard) ──────────────────────────
  // A user marked this person/org as a conflict on the contact page.
  // Any identity hit on a flagged contact is a conflict, including the
  // candidate's own contact (ADR-026 amendment): the flag is the firm
  // saying "do not take this person on", and that is exactly the lead.
  // Inactive contacts count; merged-away ones carried their flag to
  // the survivor.
  const identity = [
    ...(emailKey ? [{ email: { equals: emailKey, mode: "insensitive" as const } }] : []),
    ...(nameKey ? [{ name: { equals: nameKey, mode: "insensitive" as const } }] : []),
    ...(orgKey ? [{ organization: { equals: orgKey, mode: "insensitive" as const } }] : []),
  ];
  const flagged = await prisma.contact.findMany({
    where: { mergedIntoId: null, conflictStatus: "flagged", OR: identity },
    select: { id: true, name: true, email: true, organization: true, isActive: true },
    orderBy: { name: "asc" },
  });
  for (const c of flagged) {
    const matchedField =
      emailKey && normalize(c.email) === emailKey
        ? "email"
        : nameKey && normalize(c.name) === nameKey
          ? "name"
          : "organization";
    matches.push({
      kind: "contact_flagged",
      severity: "conflict",
      matchedField,
      description: `${c.name}${c.isActive ? "" : " (inactive)"} — flagged as a conflict on their contact record`,
      contactId: c.id,
    });
  }

  return { severity: summarizeMatchSeverity(matches), matches };
}

/** Split the free-text adverse fields into the names to screen. The
 *  form's own placeholder ("City of Aurora, Officer J. Doe") puts
 *  several parties in one field, so each comma / semicolon / newline
 *  part of two or more words is screened as well as the whole value.
 *  One-word parts are skipped: they are mostly pieces of one name
 *  ("Smith, John", "Acme, Inc."), which the whole-value check covers,
 *  and alone they would match any single-name contact. Exported for
 *  testing. */
export function adverseNameKeys(values: Array<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const v of values) {
    const whole = normalize(v);
    if (!whole) continue;
    keys.add(whole);
    for (const part of whole.split(/[,;\n]/)) {
      const k = normalize(part);
      if (k.includes(" ")) keys.add(k);
    }
  }
  return [...keys];
}

/**
 * The other direction of a conflict check: is the party we'd be
 * ADVERSE to someone the firm represents? `runConflictMatcher` screens
 * a prospective client against adverse parties on existing matters;
 * this screens a new matter's opposing party / firm against existing
 * clients, by contact name or organization (case-insensitive,
 * normalized, every row — same no-cap rule as above).
 *
 *   - "conflict": the name is a client (Matter.client or a client
 *     party row) on an active matter, or a manually flagged contact.
 *   - "warn": the name is a client only on archived matters — a former
 *     client, worth a Rule 1.9 look, one match per matter so the
 *     display wall can redact each — or it matches only a contact's
 *     ORGANIZATION (suing a client's employer is not a conflict by
 *     itself, but an organizational client is stored the same way).
 *
 * `ownClientIds` are the matter's own clients, never screened as its
 * adversaries.
 *
 * Merged-away contacts are excluded (their rows moved to the
 * survivor); deactivated ones still count, as in the client path.
 */
export async function runAdverseConflictMatcher(
  adverseNames: Array<string | null | undefined>,
  ownClientIds: string[] = [],
): Promise<ConflictCheckResult> {
  const keys = adverseNameKeys(adverseNames);
  if (keys.length === 0) return { severity: "clear", matches: [] };

  const identity = keys.flatMap((k) => [
    { name: { equals: k, mode: "insensitive" as const } },
    { organization: { equals: k, mode: "insensitive" as const } },
  ]);
  const contacts = await prisma.contact.findMany({
    where: {
      mergedIntoId: null,
      OR: identity,
      ...(ownClientIds.length > 0 ? { id: { notIn: ownClientIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      organization: true,
      isActive: true,
      conflictStatus: true,
      clientMatters: { select: { id: true, name: true, isArchived: true } },
      mattersAsClient: {
        where: { category: "client" },
        select: { matter: { select: { id: true, name: true, isArchived: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  const matches: ConflictMatch[] = [];
  for (const c of contacts) {
    const label = `${c.name}${c.isActive ? "" : " (inactive)"}`;
    const byName = keys.includes(normalize(c.name));
    const matchedField = byName ? "name" : "organization";
    const matters = new Map<string, { name: string; isArchived: boolean }>();
    for (const m of c.clientMatters) matters.set(m.id, m);
    for (const mc of c.mattersAsClient) matters.set(mc.matter.id, mc.matter);
    const active = [...matters].filter(([, m]) => !m.isArchived);
    const archived = [...matters].filter(([, m]) => m.isArchived);

    for (const [matterId, m] of active) {
      matches.push({
        kind: "adverse_is_client",
        severity: byName ? "conflict" : "warn",
        matchedField,
        description: byName
          ? `${label} — adverse party is a current client on matter "${m.name}"`
          : `${label} (${c.organization}) — client on matter "${m.name}" shares the adverse party's organization`,
        contactId: c.id,
        matterId,
      });
    }
    if (active.length === 0) {
      for (const [matterId, m] of archived) {
        matches.push({
          kind: "adverse_is_client",
          severity: "warn",
          matchedField,
          description: `${label} — adverse party is a former client (archived matter "${m.name}")`,
          contactId: c.id,
          matterId,
        });
      }
    }
    if (c.conflictStatus === "flagged") {
      matches.push({
        kind: "contact_flagged",
        // A flagged person whose ORGANIZATION is the adverse party is
        // not the adverse party: worth a look, not a hard stop.
        severity: byName ? "conflict" : "warn",
        matchedField,
        description: byName
          ? `${label} — flagged as a conflict on their contact record`
          : `${label} (${c.organization}) — flagged as a conflict; shares the adverse party's organization`,
        contactId: c.id,
      });
    }
  }

  return { severity: summarizeMatchSeverity(matches), matches };
}
