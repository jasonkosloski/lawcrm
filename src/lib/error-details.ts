/**
 * Narrow the `error` prop an App Router error boundary receives.
 *
 * Next types it as `Error & { digest?: string }`, but a value thrown
 * from a Client Component arrives as-is and may not be an Error at
 * all (a string, null, ...). Reading `.message` off it would throw
 * inside the boundary itself, so every boundary narrows through this.
 * `digest` ties a production client error to the matching server log
 * line.
 */
export function errorDetails(error: unknown): {
  message: string | null;
  digest: string | null;
} {
  const message = error instanceof Error && error.message ? error.message : null;
  const rawDigest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest?: unknown }).digest
      : null;
  const digest = typeof rawDigest === "string" && rawDigest ? rawDigest : null;
  return { message, digest };
}
