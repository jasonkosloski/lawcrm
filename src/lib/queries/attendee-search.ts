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
 * Matching happens in the database (`contains` with
 * `mode: "insensitive"` — we're on Postgres) so the whole
 * directory is searchable, not just whatever rows a capped
 * fetch happens to return.
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

export async function searchAttendees(
  rawQuery: string,
  options: {
    /** Already-picked attendee ids (split into user + contact)
     *  so the picker doesn't suggest the same row twice. */
    excludeUserIds?: readonly string[];
    excludeContactIds?: readonly string[];
  } = {}
): Promise<AttendeeSearchResult[]> {
  const query = rawQuery.trim();
  if (query.length === 0) return [];

  // Exclusions ride in the where clause (`notIn`) rather than a
  // post-fetch filter — otherwise already-picked rows would eat
  // into the cap and starve the returned list.
  const excludeUserIds = [...(options.excludeUserIds ?? [])];
  const excludeContactIds = [...(options.excludeContactIds ?? [])];

  const firm = await getCurrentFirm();

  // Pull both buckets in parallel. The text match lives in the
  // query itself so the entire directory is searchable — a
  // `take` without a match predicate would cap the search to an
  // arbitrary slice of the table. `orderBy: name` keeps results
  // stable across keystrokes.
  //
  // Firm scoping: users are already firm-scoped via
  // `User.firmId`. Contacts get the same treatment — but we also
  // accept legacy rows with `firmId IS NULL` for now so the
  // picker keeps showing pre-multi-tenancy data. Drop the
  // null branch once Contact.firmId is backfilled + tightened
  // to required.
  const [users, contacts] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        firmId: firm.id,
        id: { notIn: excludeUserIds },
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
          { jobTitle: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        initials: true,
        jobTitle: true,
      },
      orderBy: { name: "asc" },
      take: USER_CAP,
    }),
    prisma.contact.findMany({
      where: {
        isActive: true,
        id: { notIn: excludeContactIds },
        // Two independent ORs (firm scope + text match) — nest
        // under AND so they don't collide on the `OR` key.
        AND: [
          { OR: [{ firmId: firm.id }, { firmId: null }] },
          {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { organization: { contains: query, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        type: true,
        organization: true,
      },
      orderBy: { name: "asc" },
      take: CONTACT_CAP,
    }),
  ]);

  const matchedUsers: AttendeeSearchResult[] = users.map((u) => ({
    kind: "user",
    id: u.id,
    name: u.name,
    email: u.email,
    initials: u.initials,
    jobTitle: u.jobTitle,
  }));

  const matchedContacts: AttendeeSearchResult[] = contacts.map((c) => ({
    kind: "contact",
    id: c.id,
    name: c.name,
    email: c.email,
    type: c.type,
    organization: c.organization,
  }));

  return [...matchedUsers, ...matchedContacts];
}
