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
 * SQLite note: Prisma's `mode: "insensitive"` isn't supported on
 * SQLite, so the matcher pulls candidate sets with the literal
 * candidate value and re-filters in JS using normalize() to make
 * matching case- and whitespace-tolerant. The candidate sets are
 * bounded (top 200 contacts per match path) so this stays cheap
 * for any reasonable firm size.
 */

import { prisma } from "@/lib/prisma";

export type ConflictMatchKind =
  | "contact_email"
  | "contact_name"
  | "matter_opposing_party"
  | "matter_opposing_firm";

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
export function summarizeMatchSeverity(
  matches: ConflictMatch[]
): ConflictCheckResult["severity"] {
  if (matches.some((m) => m.severity === "conflict")) return "conflict";
  if (matches.length > 0) return "warn";
  return "clear";
}

const CANDIDATE_LIMIT = 200;

export async function runConflictMatcher(
  candidate: ConflictCandidate
): Promise<ConflictCheckResult> {
  const nameKey = normalize(candidate.name);
  const emailKey = normalize(candidate.email);
  const orgKey = normalize(candidate.organization);

  if (!nameKey && !emailKey && !orgKey) {
    return { severity: "clear", matches: [] };
  }

  const matches: ConflictMatch[] = [];
  const seenContactIds = new Set<string>();

  // ── Email match (hard signal when used in opposing-side roles) ─
  if (emailKey) {
    // Pull every active contact with a non-null email, then filter
    // in JS — Prisma SQLite doesn't support insensitive equals.
    const contactsWithEmail = await prisma.contact.findMany({
      where: { isActive: true, email: { not: null } },
      select: {
        id: true,
        name: true,
        email: true,
        type: true,
        organization: true,
      },
      take: CANDIDATE_LIMIT,
    });
    const emailHits = contactsWithEmail.filter(
      (c) => normalize(c.email) === emailKey
    );
    for (const c of emailHits) {
      const opposingSideUse = await prisma.matterContact.count({
        where: {
          contactId: c.id,
          NOT: { category: "client" },
        },
      });
      matches.push({
        kind: "contact_email",
        severity: opposingSideUse > 0 ? "conflict" : "warn",
        matchedField: "email",
        description:
          opposingSideUse > 0
            ? `${c.name} — same email; appears on opposing side of ${opposingSideUse} matter${opposingSideUse === 1 ? "" : "s"}`
            : `${c.name} — same email already in the firm's contact directory`,
        contactId: c.id,
      });
      seenContactIds.add(c.id);
    }
  }

  // ── Exact name match against opposing parties on matters ─────
  if (nameKey) {
    // Legacy free-text fields on Matter (opposingParty / opposingFirm).
    const matterCandidates = await prisma.matter.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        name: true,
        opposingParty: true,
        opposingFirm: true,
      },
      take: CANDIDATE_LIMIT,
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
    // counsel, witness, etc.) joined to Contact. Filter in JS.
    const partyCandidates = await prisma.matterContact.findMany({
      where: {
        NOT: { category: "client" },
        matter: { isArchived: false },
      },
      select: {
        id: true,
        category: true,
        matter: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, isActive: true } },
      },
      take: CANDIDATE_LIMIT,
    });
    for (const mc of partyCandidates) {
      if (!mc.contact?.isActive) continue;
      if (normalize(mc.contact.name) !== nameKey) continue;
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

    // Soft signal: same name appears as any contact. Skip when
    // we already counted the contact via a higher-severity path.
    const nameCandidates = await prisma.contact.findMany({
      where: { isActive: true },
      select: { id: true, name: true, type: true },
      take: CANDIDATE_LIMIT,
    });
    for (const c of nameCandidates) {
      if (seenContactIds.has(c.id)) continue;
      if (normalize(c.name) !== nameKey) continue;
      matches.push({
        kind: "contact_name",
        severity: "warn",
        matchedField: "name",
        description: `${c.name} — same name in the firm's contact directory (${c.type})`,
        contactId: c.id,
      });
      seenContactIds.add(c.id);
    }
  }

  // ── Organization soft match ──────────────────────────────────
  if (orgKey) {
    const orgCandidates = await prisma.contact.findMany({
      where: { isActive: true, organization: { not: null } },
      select: { id: true, name: true, organization: true, type: true },
      take: CANDIDATE_LIMIT,
    });
    for (const c of orgCandidates) {
      if (seenContactIds.has(c.id)) continue;
      if (normalize(c.organization) !== orgKey) continue;
      matches.push({
        kind: "contact_name",
        severity: "warn",
        matchedField: "organization",
        description: `${c.name} (${c.organization}) — same organization`,
        contactId: c.id,
      });
      seenContactIds.add(c.id);
    }
  }

  return { severity: summarizeMatchSeverity(matches), matches };
}
