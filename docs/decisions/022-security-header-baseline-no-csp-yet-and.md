# ADR-022: Security-header baseline, no CSP yet, and "no class on user HTML"

**Date:** 2026-10-16
**Status:** Accepted

**Context:** The W6b content-security sweep found (a) no response security headers, (b) sanitizer profiles that let `class` through on inbound email and note HTML while the app ships a global Tailwind stylesheet (a hostile `class="fixed inset-0 z-50 bg-white"` overlays the whole CRM), (c) a prefix check in `src/proxy.ts` that was not path-boundary aware, and (d) docx-preview output whose `<style>` text (built from unescaped document strings) was appended to the live page before sanitation.

**Decision:**

- **Headers** (`next.config.ts`, pinned by `src/next-config.test.ts`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal `Permissions-Policy`. The two same-origin routes the document viewer iframes (`/api/documents/:id/download`, `/api/email-attachments/:id/download`) get `SAMEORIGIN` instead. The rules are non-overlapping (the catch-all negative-matches those routes) so behavior never depends on how Next/Vercel merge repeated keys.
- **No CSP yet.** A script-src/style-src policy needs per-request nonces in `proxy.ts` and has to be proven against Next's inline bootstrap scripts, Tiptap and Tailwind inline styles, docx-preview, the PDF iframe and presigned Blob downloads; that cannot be verified without a browser pass and a wrong CSP breaks the app. The download routes already send their own `Content-Security-Policy: sandbox`. Rollout plan: ship `Content-Security-Policy-Report-Only` first, watch reports, then enforce. **Stage 1 shipped 2026-10-18:** a static report-only policy (inline script/style still allowed, no nonces yet; `object-src 'none'`, `base-uri`/`form-action 'self'`, `frame-ancestors` mirroring X-Frame-Options) reports to the public, log-only `/api/csp-report` sink (`[csp-report]` lines). **Stage 2 shipped 2026-10-18:** pages get a strict per-request nonce policy from `src/proxy.ts` (`src/lib/csp.ts`: `'nonce-…' 'strict-dynamic'`, nonce'd `<style>` only, `style-src-attr 'unsafe-inline'` for React style props), still report-only; Next stamps the nonce on its own scripts and styles. The framed file routes keep a static policy in `next.config.ts`; API JSON gets none. In dev the Next error overlay's font `<style>` reports (dev-only). Next: after a week of clean `[csp-report]` logs, flip `CSP_HEADER` to `Content-Security-Policy`.
- **Sanitizer contract:** no profile allows `class`, except the exact token `email-blocked-image` on `span` in the email profile. A renderer that needs a class must allowlist the exact name. Because stored rows predate this, `EmailMessage.body` and `Note.content` are **re-sanitized at read time** (idempotent, cheap): in `thread-reader.tsx` and in the note queries in `matter-detail/notes.ts` / `calendar.ts` that feed every note renderer. Protocol-relative hrefs are rejected in every profile.
- **`poweredByHeader` is off** (`next.config.ts`).
- **Reply recipient integrity:** the reply composer posts the recipients it displayed plus a `recipientsEdited` flag; `email-send.ts` re-derives the unedited recipients server-side and refuses with `recipients_changed` if they moved since the composer rendered, so a reply can't silently go to a different set than the user saw.
- **Proxy:** public-prefix matching is path-boundary aware (`/login` and `/login/x`, not `/loginfoo`); `SELF_AUTHENTICATED_PATHS` stays an exact-match set.
- **docx-preview:** the render is built detached (`parseAsync` + `renderDocument`), sanitized by `sanitizeRenderedDocx` (rule-by-rule `<style>` rebuild, `url()`/fetch-function neutralizing), and only then attached, so nothing a hostile document injects applies or fetches before it is clean. A sandboxed iframe was the alternative; detaching was chosen because it keeps text selection and TreeWalker quote relocation (evidence review) working on the same DOM.

**Trade-offs:**

- (+) Clickjacking, MIME sniffing and referrer leaks closed with no behavior risk
- (+) Legacy hostile rows are neutralized without a data migration
- (-) No CSP means an XSS bug elsewhere is not contained by the browser; the sanitizers remain the primary boundary
- (-) Read-time sanitizing costs a parse per note/email render (bounded by the existing list caps)
- (-) Lenient server-side email validation for contacts, parties and calendar attendees (F987) is still open; `EmailLink` encodes the address at render time
