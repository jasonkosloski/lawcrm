import type { NextConfig } from "next";
import { CSP_HEADER, fileRouteCsp } from "./src/lib/csp";

/**
 * Baseline security response headers (F261/F392/F927/F442).
 *
 *   - X-Frame-Options DENY: no page of the CRM may be framed by anyone
 *     (clickjacking on send/void/apply-trust buttons).
 *   - X-Content-Type-Options nosniff: never reinterpret a response type.
 *   - Referrer-Policy strict-origin-when-cross-origin: matter / document
 *     ids in the URL never leak to the external sites that email and
 *     note links open.
 *   - Permissions-Policy: the CRM uses no camera, microphone, location
 *     or payment APIs - switch them off so injected content can't ask.
 *
 * NO enforced Content-Security-Policy is shipped. A script-src/style-src policy
 * needs per-request nonces (proxy.ts) and must be verified against Next's
 * inline bootstrap scripts, Tiptap and Tailwind inline styles, the
 * docx-preview renderer, the PDF iframe and presigned Blob downloads;
 * that cannot be proven safe without a browser pass, and a wrong CSP
 * breaks the whole app. `frame-ancestors` is covered by X-Frame-Options,
 * and the two download routes already send their own `Content-Security-
 * Policy: sandbox`, which a global CSP header would have to merge with.
 * Rollout stage 2 (live): pages get a per-request nonce policy from
 * src/proxy.ts (src/lib/csp.ts), report-only, reporting to
 * /api/csp-report. Only the viewer-framed file routes get a static
 * policy here; API JSON gets none.
 */
export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

/**
 * The document viewer embeds the file-serving routes in a SAME-ORIGIN
 * <iframe> (pdf-viewer.tsx, evidence/pdf-review.tsx), and X-Frame-Options
 * applies to the framed response, so these routes - and only these - get
 * SAMEORIGIN instead of DENY.
 *
 * The rules are deliberately NON-OVERLAPPING: the catch-all below
 * negative-matches these two routes, so no path ever depends on how
 * Next/Vercel merge several matching header rules for one key.
 */
export const FRAMEABLE_FILE_ROUTES = [
  "/api/documents/:id/download",
  "/api/email-attachments/:id/download",
];

/** Catch-all source that matches every path EXCEPT the frameable file
 *  routes above (one id segment, optional trailing slash). Kept in
 *  lockstep with FRAMEABLE_FILE_ROUTES by src/next-config.test.ts. */
export const NON_FRAMEABLE_SOURCE =
  "/:path((?!api/documents/[^/]+/download/?$|api/email-attachments/[^/]+/download/?$).*)";

const nextConfig: NextConfig = {
  // Don't advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,

  // The invoice PDF reads its .ttf fonts from disk at runtime; the file
  // tracer can't see that, so ship them with every server route (invoices
  // are sent from server actions on many pages).
  outputFileTracingIncludes: {
    "/**": ["./src/lib/billing/fonts/**", "./src/lib/templates/fonts/**"],
  },

  async headers() {
    return [
      {
        source: NON_FRAMEABLE_SOURCE,
        headers: SECURITY_HEADERS,
      },
      ...FRAMEABLE_FILE_ROUTES.map((source) => ({
        source,
        headers: [
          ...SECURITY_HEADERS.filter((h) => h.key !== "X-Frame-Options"),
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: CSP_HEADER, value: fileRouteCsp() },
        ],
      })),
    ];
  },
};

export default nextConfig;
