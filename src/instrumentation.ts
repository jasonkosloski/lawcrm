/**
 * Next.js instrumentation hooks (runs on the server only).
 *
 * - `register`: fail the instance at boot when required env is
 *   missing (see src/lib/env-check.ts).
 * - `onRequestError`: one structured `[server-error]` line per
 *   uncaught server error, so a Vercel log drain or log alert can
 *   match on it. Headers are deliberately not logged (cookies).
 */

import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { enforceEnv } = await import("@/lib/env-check");
    enforceEnv();
  }
}

export const onRequestError: Instrumentation.onRequestError = (
  err,
  request,
  context
) => {
  console.error(
    "[server-error]",
    JSON.stringify({
      message: err instanceof Error ? err.message : String(err),
      digest:
        typeof err === "object" && err !== null && "digest" in err
          ? String(err.digest)
          : undefined,
      method: request.method,
      path: request.path,
      routePath: context.routePath,
      routeType: context.routeType,
    })
  );
};
