/**
 * Attendee-search server action — wraps the query so the
 * autocomplete picker (a client component) can call it without a
 * dedicated REST endpoint.
 *
 * Auth: identity-scoped (current user). Result rows are firm
 * users + contacts the firm owns; nothing leaks across firms
 * (single-tenant today; when multi-tenant lands, the query
 * itself adds firm scope and this action stays unchanged).
 */

"use server";

import { getCurrentUserId } from "@/lib/current-user";
import {
  searchAttendees,
  type AttendeeSearchResult,
} from "@/lib/queries/attendee-search";

export async function searchAttendeesAction(
  query: string,
  excludeUserIds: string[],
  excludeContactIds: string[]
): Promise<AttendeeSearchResult[]> {
  // Forces a session check; the picker is editor-only on the
  // client side too.
  await getCurrentUserId();
  return searchAttendees(query, { excludeUserIds, excludeContactIds });
}
