/**
 * Attendee-search server action — wraps the query so the
 * autocomplete picker (a client component) can call it without a
 * dedicated REST endpoint.
 *
 * Auth: identity-scoped (current user). Result rows are firm
 * users + contacts the firm owns; nothing leaks across firms
 * (single-tenant today; when multi-tenant lands, the query
 * itself adds firm scope and this action stays unchanged).
 *
 * Server actions are public POST endpoints: the TypeScript argument
 * types are not enforced at runtime, so the payload is validated
 * here. A malformed or oversized payload returns an empty result
 * instead of throwing a 500 (non-string query) or building a
 * Postgres-parameter-limit-busting NOT IN list.
 */

"use server";

import { z } from "zod";
import { getCurrentUserId } from "@/lib/current-user";
import { searchAttendees, type AttendeeSearchResult } from "@/lib/queries/attendee-search";

const searchInputSchema = z.object({
  query: z.string().max(100),
  excludeUserIds: z.array(z.string().max(64)).max(200),
  excludeContactIds: z.array(z.string().max(64)).max(200),
});

export async function searchAttendeesAction(
  query: string,
  excludeUserIds: string[],
  excludeContactIds: string[],
): Promise<AttendeeSearchResult[]> {
  // Forces a session check; the picker is editor-only on the
  // client side too. Runs before anything else.
  await getCurrentUserId();
  const input = searchInputSchema.safeParse({
    query,
    excludeUserIds,
    excludeContactIds,
  });
  if (!input.success) return [];
  return searchAttendees(input.data.query, {
    excludeUserIds: input.data.excludeUserIds,
    excludeContactIds: input.data.excludeContactIds,
  });
}
