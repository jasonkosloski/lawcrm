/**
 * Prisma known-request error codes that actions branch on — usually a
 * race (a duplicate inserted, a row deleted, a dependent added) turned
 * into a friendly refusal instead of an error boundary.
 *
 * Duck-typed on `code` rather than `instanceof
 * PrismaClientKnownRequestError`, so errors rethrown out of a
 * `$transaction` and plain test doubles match the same way.
 */

function hasPrismaCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/** P2002: unique constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  return hasPrismaCode(err, "P2002");
}

/** P2003: foreign-key violation (a parent vanished, or a dependent
 *  appeared under a restrict). */
export function isForeignKeyViolation(err: unknown): boolean {
  return hasPrismaCode(err, "P2003");
}

/** P2025: the record to update/delete no longer exists. */
export function isRecordNotFound(err: unknown): boolean {
  return hasPrismaCode(err, "P2025");
}
