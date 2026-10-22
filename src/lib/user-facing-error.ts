/**
 * Errors whose message is written for the end user and is safe to
 * show in the UI. Server actions throw these for intentional,
 * business-rule refusals ("Nothing unbilled to invoice", "Trust would
 * overdraw"...). Anything else (Prisma errors, driver errors, bugs)
 * can carry schema / query / path details, so `toUserMessage` logs it
 * server-side and returns a generic fallback instead.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Message to return to the client for a caught error. User-facing
 *  errors pass through verbatim; everything else is console.error'd
 *  (with `context` for the log line) and replaced by `fallback`. */
export function toUserMessage(err: unknown, fallback: string, context: string): string {
  if (err instanceof UserFacingError) return err.message;
  console.error(`[${context}]`, err);
  return fallback;
}
