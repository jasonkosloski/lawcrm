/**
 * Classifies a thrown error as a TRANSIENT infrastructure failure
 * (database connectivity / contention) versus a deterministic
 * data-level one.
 *
 * Sync passes isolate per-item failures (a poisoned thread or
 * calendar event is logged and skipped so the history cursor / sync
 * token can still advance — F069). That is only safe for failures
 * that will recur identically on every retry (a value the database
 * rejects, a malformed payload): skipping those loses nothing a
 * retry could recover. A connection reset, pool timeout, deadlock or
 * serialization failure is the opposite — the item is fine, the
 * database blinked — and skipping it while advancing the cursor
 * would silently and permanently drop mail / calendar changes. Those
 * errors must abort the pass so the cursor stays put and the next
 * run retries.
 */

import { Prisma } from "@/generated/prisma/client";

/** Prisma request codes that mean "try again later", not "bad data":
 *  P1001 can't reach DB, P1002 DB timed out, P1008 operation timed
 *  out, P1017 server closed the connection, P2024 pool timeout,
 *  P2034 write conflict / deadlock. */
const TRANSIENT_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"]);

/** Node socket-level codes and Postgres SQLSTATEs (as surfaced by the
 *  `pg` driver adapter) for connectivity / contention. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
]);

export function isTransientInfraError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 3) return false;
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    return true;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_PRISMA_CODES.has(err.code);
  }
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") {
    if (TRANSIENT_PRISMA_CODES.has(code) || TRANSIENT_CODES.has(code)) {
      return true;
    }
    if (code.startsWith("08")) return true; // SQLSTATE class 08: connection exception
  }
  const message = (err as { message?: unknown }).message;
  if (
    typeof message === "string" &&
    /connection terminated|connection (?:reset|closed)|timeout exceeded when trying to connect/i.test(
      message,
    )
  ) {
    return true;
  }
  return isTransientInfraError((err as { cause?: unknown }).cause, depth + 1);
}
