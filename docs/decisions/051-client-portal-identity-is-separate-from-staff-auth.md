# ADR-051: Client portal identity is separate from staff auth

**Date:** 2026-10-18
**Status:** Accepted

**Context:** Clients need to sign in to see their matters. Staff auth (Auth.js credentials, argon2id, JWT) is built for firm members and is deliberately frozen until the planned auth overhaul. Clients are external, low-frequency users who should not have passwords, and a client session must never be usable on staff routes (or the reverse).

**Decision:**

- **Approved exception (user, 2026-10-18)** to the deferred staff-auth work: the portal gets its own identity model (`PortalIdentity`, per-matter `PortalMatterAccess`) and its own sign-in. Staff authentication is untouched.
- **Magic link, no passwords.** Single-use tokens (SHA-256 hash stored; 15 min for login, 7 days for invite) are emailed. Invite and revoke are per matter, by staff only.
- **Database sessions**, not JWT: `PortalSession` rows (hash of a random cookie value, sliding expiry capped at 30 days) so revoke, disable and email change take effect immediately by deleting rows.
- **Host-only cookie** (`__Host-portal_session`) on a separate `PORTAL_HOST`, so the browser never sends it to the staff host and staff cookies never reach the portal.
- **POST-confirmed tokens.** The link opens a page with a Sign in button; only the POST spends the token. Mail scanners and link previewers prefetch GETs, which would burn a GET-consumed token before the client clicks. Verify also re-checks the portal switch and a live access row.
- **Isolation is enforced in both session readers**, not only the proxy: the Auth.js `jwt` callback treats any portal-host request as signed out, and `getPortalIdentity` returns null off the portal host. The proxy's matcher exclusions and server-action forwarding can route portal-host requests to staff handlers, so the proxy alone is not a boundary.
- Identity-wide changes require sight of all the identity's matters (ADR-039); `PortalIdentity.email` is unique so link lookup is deterministic; the console email driver is refused in production so links never reach logs.

**Trade-offs:**

- (+) No client passwords to leak, reset or support; instant revocation; a stolen staff cookie is useless on the portal and vice versa
- (+) Reuses the app, deploy and CSP; no second project to run
- (-) A second, small auth stack to maintain until the staff overhaul can decide whether to unify
- (-) Sign-in security equals mailbox security; deliverability (SPF/DKIM) is a launch dependency
- (-) Two contacts cannot share one login email
- (-) One codebase serves both hosts, so isolation depends on the tests that pin it
