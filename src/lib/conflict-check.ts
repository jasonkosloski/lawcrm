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
export function summarizeMatchSeverity(
  matches: ConflictMatch[]
): ConflictCheckResult["severity"] {
  if (matches.some((m) => m.severity === "conflict")) return "conflict";
  if (matches.length > 0) return "warn";
  return "clear";
}

export async function runConflictMatcher(
  candidate: ConflictCandidate
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
    for (const c of emailHits) {
      // Hard tier requires the opposing-side use to be on an
      // ACTIVE matter (see header) — archived files only warn.
      const opposingSideUse = await prisma.matterContact.count({
        where: {
          contactId: c.id,
          NOT: { category: "client" },
          matter: { isArchived: false },
        },
      });
      seenContactIds.add(c.id);
      // The soft "already in the directory" warn applies to active
      // contacts only, and never to the candidate's own Contact.
      if (opposingSideUse === 0 && (!c.isActive || c.id === ownContactId)) {
        continue;
      }
      matches.push({
        kind: "contact_email",
        severity: opposingSideUse > 0 ? "conflict" : "warn",
        matchedField: "email",
        description:
          opposingSideUse > 0
            ? `${c.name} — same email; appears on opposing side of ${opposingSideUse} active matter${opposingSideUse === 1 ? "" : "s"}`
            : `${c.name} — same email already in the firm's contact directory`,
        contactId: c.id,
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

    // Soft signal: same name appears as any contact. Skip when
    // we already counted the contact via a higher-severity path.
    const nameCandidates = await prisma.contact.findMany({
      where: {
        isActive: true,
        name: { equals: nameKey, mode: "insensitive" },
      },
      select: { id: true, name: true, type: true },
    });
    for (const c of nameCandidates) {
      if (seenContactIds.has(c.id) || c.id === ownContactId) continue;
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
      where: {
        isActive: true,
        organization: { equals: orgKey, mode: "insensitive" },
      },
      select: { id: true, name: true, organization: true, type: true },
    });
    for (const c of orgCandidates) {
      if (seenContactIds.has(c.id) || c.id === ownContactId) continue;
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
