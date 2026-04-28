/**
 * Attendee autocomplete search.
 *
 * Drives the calendar event modal's attendee picker. Returns a
 * mixed list of firm users + contacts ranked by match quality:
 * users come first (they're the firm's own people, most common
 * pick), contacts second. Each row carries a kind discriminator
 * so the picker can render type chips / avatars + dispatch the
 * right "link" branch on commit.
 *
 * SQLite-friendly: no `mode: "insensitive"` (Prisma's case-
 * insensitive flag isn't supported on SQLite). We do the
 * comparison case-insensitively in the app layer instead, same
 * pattern as `lib/conflict-check.ts`.
 *
 * Caps: 6 users + 6 contacts max so the dropdown stays
 * readable. The user can refine the query if their pick isn't in
 * the first batch.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentFirm } from "@/lib/firm";

export type AttendeeSearchResult =
  | {
      kind: "user";
      id: string;
      name: string;
      email: string;
      initials: string;
      jobTitle: string;
    }
  | {
      kind: "contact";
      id: string;
      name: string;
      email: string | null;
      type: string;
      organization: string | null;
    };

const USER_CAP = 6;
const CONTACT_CAP = 6;

/** Case-insensitive substring match. Cheap and good enough for
 *  short autocomplete inputs. */
function matches(haystack: string | null, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

export async function searchAttendees(
  rawQuery: string,
  options: {
    /** Already-picked attendee ids (split into user + contact)
     *  so the picker doesn't suggest the same row twice. */
    excludeUserIds?: readonly string[];
    excludeContactIds?: readonly string[];
  } = {}
): Promise<AttendeeSearchResult[]> {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return [];

  const excludeUserIds = new Set(options.excludeUserIds ?? []);
  const excludeContactIds = new Set(options.excludeContactIds ?? []);

  const firm = await getCurrentFirm();

  // Pull both buckets in parallel. We over-fetch slightly (5x
  // the cap) so the app-layer case-insensitive filter has room
  // to drop duplicates / excluded ids without starving the
  // returned list.
  //
  // Firm scoping: users are already firm-scoped via
  // `User.firmId`. Contacts get the same treatment — but we also
  // accept legacy rows with `firmId IS NULL` for now so the
  // picker keeps showing pre-multi-tenancy data. Drop the
  // null branch once Contact.firmId is backfilled + tightened
  // to required.
  const [users, contacts] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, firmId: firm.id },
      select: {
        id: true,
        name: true,
        email: true,
        initials: true,
        jobTitle: true,
      },
      take: USER_CAP * 5,
    }),
    prisma.contact.findMany({
      where: {
        isActive: true,
        OR: [{ firmId: firm.id }, { firmId: null }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        type: true,
        organization: true,
      },
      take: CONTACT_CAP * 5,
    }),
  ]);

  const matchedUsers: AttendeeSearchResult[] = users
    .filter((u) => !excludeUserIds.has(u.id))
    .filter(
      (u) =>
        matches(u.name, query) ||
        matches(u.email, query) ||
        matches(u.jobTitle, query)
    )
    .slice(0, USER_CAP)
    .map((u) => ({
      kind: "user",
      id: u.id,
      name: u.name,
      email: u.email,
      initials: u.initials,
      jobTitle: u.jobTitle,
    }));

  const matchedContacts: AttendeeSearchResult[] = contacts
    .filter((c) => !excludeContactIds.has(c.id))
    .filter(
      (c) =>
        matches(c.name, query) ||
        matches(c.email, query) ||
        matches(c.organization, query)
    )
    .slice(0, CONTACT_CAP)
    .map((c) => ({
      kind: "contact",
      id: c.id,
      name: c.name,
      email: c.email,
      type: c.type,
      organization: c.organization,
    }));

  return [...matchedUsers, ...matchedContacts];
}
