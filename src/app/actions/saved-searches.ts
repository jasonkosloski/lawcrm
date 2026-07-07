/**
 * Saved-search mutating actions — create / rename / delete the
 * current user's saved searches (the "Saved" strip on /search).
 *
 * Auth: identity, not permission. A saved search is the user's own
 * bookmark — it grants no access (running it goes through
 * `globalSearch`, which enforces every read-model guard itself), so
 * following the notifications.ts precedent there is NO permission
 * key. Every mutation scopes its where-clause by the current user's
 * id, so a guessed/stale id belonging to another user never
 * resolves — it reads as "not found".
 *
 * Validation mirrors the search page's own gates:
 *   - `q` must clear SEARCH_MIN_QUERY_LENGTH after trimming (a
 *     shorter query can't produce results, so saving it is a trap).
 *   - `name` is 1..SAVED_SEARCH_NAME_MAX chars (the client defaults
 *     it to the query text).
 *   - `type`, when present, must be a real SearchHitType.
 *   - Per-user row count is capped at SAVED_SEARCH_CAP.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  isSearchHitType,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchHitType,
} from "@/lib/queries/search";
import {
  SAVED_SEARCH_CAP,
  SAVED_SEARCH_NAME_MAX,
} from "@/lib/queries/saved-searches";

export type SavedSearchCreateResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type SavedSearchMutateResult =
  | { ok: true }
  | { ok: false; error: string };

/** Shared name gate for create + rename. Returns the trimmed name
 *  or a user-facing error. */
function cleanName(raw: string): { name: string } | { error: string } {
  const name = raw.trim();
  if (name.length === 0) {
    return { error: "Give the saved search a name." };
  }
  if (name.length > SAVED_SEARCH_NAME_MAX) {
    return {
      error: `Names are capped at ${SAVED_SEARCH_NAME_MAX} characters.`,
    };
  }
  return { name };
}

export async function createSavedSearch(
  name: string,
  q: string,
  type?: string | null
): Promise<SavedSearchCreateResult> {
  const userId = await getCurrentUserId();

  const query = q.trim();
  if (query.length < SEARCH_MIN_QUERY_LENGTH) {
    return {
      ok: false,
      error: `Searches need at least ${SEARCH_MIN_QUERY_LENGTH} characters.`,
    };
  }

  const named = cleanName(name);
  if ("error" in named) return { ok: false, error: named.error };

  // Empty string from a form field means "no scope", same as null.
  let scope: SearchHitType | null = null;
  if (type != null && type !== "") {
    if (!isSearchHitType(type)) {
      return { ok: false, error: `Unknown search scope "${type}".` };
    }
    scope = type;
  }

  // Idempotent on (query, scope): saving the same search twice
  // returns the existing row instead of stacking duplicates.
  // Case-insensitive on the query because the search itself is.
  const existing = await prisma.savedSearch.findFirst({
    where: {
      userId,
      type: scope,
      q: { equals: query, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existing) return { ok: true, id: existing.id };

  const count = await prisma.savedSearch.count({ where: { userId } });
  if (count >= SAVED_SEARCH_CAP) {
    return {
      ok: false,
      error: `You've reached the ${SAVED_SEARCH_CAP} saved-search limit — delete one before saving another.`,
    };
  }

  const row = await prisma.savedSearch.create({
    data: { userId, name: named.name, q: query, type: scope },
    select: { id: true },
  });

  revalidatePath("/search");
  return { ok: true, id: row.id };
}

export async function renameSavedSearch(
  id: string,
  name: string
): Promise<SavedSearchMutateResult> {
  const userId = await getCurrentUserId();

  const named = cleanName(name);
  if ("error" in named) return { ok: false, error: named.error };

  // Scoped update — `userId` in the where clause means another
  // user's row can't be renamed via a guessed id.
  const result = await prisma.savedSearch.updateMany({
    where: { id, userId },
    data: { name: named.name },
  });
  if (result.count === 0) {
    return { ok: false, error: "Saved search not found." };
  }

  revalidatePath("/search");
  return { ok: true };
}

export async function deleteSavedSearch(
  id: string
): Promise<SavedSearchMutateResult> {
  const userId = await getCurrentUserId();

  // Same scoping as rename — cross-user ids read as "not found".
  const result = await prisma.savedSearch.deleteMany({
    where: { id, userId },
  });
  if (result.count === 0) {
    return { ok: false, error: "Saved search not found." };
  }

  revalidatePath("/search");
  return { ok: true };
}
