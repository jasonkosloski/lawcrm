/**
 * Content-Security-Policy builders (ADR-022 rollout).
 *
 * Stage 2: pages get a strict per-request NONCE policy, set by
 * `src/proxy.ts` on the request (Next reads the nonce from it and
 * stamps its own scripts and inline styles) and on the response.
 * Shipped REPORT-ONLY: violations post to /api/csp-report. To enforce,
 * flip CSP_HEADER to "Content-Security-Policy" once a week of reports
 * is clean.
 *
 * Pure (no Node APIs) so the proxy and next.config can both use it.
 */

export const CSP_HEADER = "Content-Security-Policy-Report-Only";

const BLOB_STORAGE = "https://*.blob.vercel-storage.com";
const REPORT = "report-uri /api/csp-report";

/** 128 random bits, base64. A fresh one per page request. */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

const CLERK_CHALLENGES = "https://challenges.cloudflare.com";
const CLERK_PROTECT = "https://*.protect.clerk.com";

/**
 * The Clerk Frontend API origin, decoded from the publishable key
 * (`pk_test_`/`pk_live_` + base64 of `<host>$`). Null when the key is
 * missing or malformed, in which case no Clerk sources are allowed.
 */
export function clerkFrontendApiOrigin(
  publishableKey: string | undefined
): string | null {
  const m = /^pk_(?:test|live)_(.+)$/.exec(publishableKey ?? "");
  if (!m) return null;
  let host: string;
  try {
    host = atob(m[1]);
  } catch {
    return null;
  }
  if (!host.endsWith("$")) return null;
  host = host.slice(0, -1);
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) return null;
  return `https://${host}`;
}

/** The nonce inside a policy string made by `pageCsp`, or undefined. */
export function nonceFromCsp(csp: string | null | undefined): string | undefined {
  return /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
}

/** The page policy. `strict-dynamic` lets nonce'd Next chunks load the
 *  rest of the bundle; style attributes (React `style` props in SSR'd
 *  HTML) stay allowed via `style-src-attr`, while <style> elements
 *  need the nonce. Dev adds what React's debugging and HMR need. */
export function pageCsp(
  nonce: string,
  opts: { isDev: boolean; clerkPublishableKey?: string }
): string {
  const clerk = clerkFrontendApiOrigin(opts.clerkPublishableKey);
  const clerkScript = clerk ? ` ${clerk} ${CLERK_CHALLENGES} ${CLERK_PROTECT}` : "";
  const clerkConnect = clerk ? ` ${clerk} ${CLERK_PROTECT}` : "";
  const clerkFrame = clerk ? ` ${CLERK_CHALLENGES} ${CLERK_PROTECT}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.isDev ? " 'unsafe-eval'" : ""}${clerkScript}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${BLOB_STORAGE} https://vercel.com${clerkConnect}${opts.isDev ? " ws:" : ""}`,
    `frame-src 'self' blob: ${BLOB_STORAGE}${clerkFrame}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    REPORT,
  ].join("; ");
}

/** Static policy for the viewer-framed file routes (no HTML scripts
 *  there; they also send their own `sandbox` CSP). */
export function fileRouteCsp(): string {
  return [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    REPORT,
  ].join("; ");
}
