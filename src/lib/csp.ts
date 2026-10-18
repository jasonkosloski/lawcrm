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

/** The page policy. `strict-dynamic` lets nonce'd Next chunks load the
 *  rest of the bundle; style attributes (React `style` props in SSR'd
 *  HTML) stay allowed via `style-src-attr`, while <style> elements
 *  need the nonce. Dev adds what React's debugging and HMR need. */
export function pageCsp(nonce: string, opts: { isDev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${BLOB_STORAGE} https://vercel.com${opts.isDev ? " ws:" : ""}`,
    `frame-src 'self' blob: ${BLOB_STORAGE}`,
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
