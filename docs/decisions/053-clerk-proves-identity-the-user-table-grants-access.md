# ADR-053: Clerk proves staff identity; the User table grants access

**Date:** 2026-10-19
**Status:** Accepted

**Context:** Staff signed in with Auth.js credentials (argon2id, JWT sessions, per-account lockout, password-fingerprint revocation; ADR-017, ADR-020). That meant owning password storage, reset, lockout and a JWT that could not be revoked one session at a time, with MFA and SSO deferred. The firm uses Google Workspace, so a hosted identity provider with Google sign-in removes all of it. The risk to avoid is letting the provider decide who may use the app: roles, matter walls (ADR-039) and deactivation all live in our database.

**Decision:**
- **Clerk is identity only.** It proves a verified Google identity. The `User` table decides access: every guard resolves the Clerk id through `getStaffAuth()` (`src/lib/staff-auth.ts`) to an active `User`, and anything else (unlinked, inactive, Clerk lookup failure, unverified email) is `no_access`. Fail closed.
- **DB-authoritative deactivation.** `User.isActive = false` denies on the next request regardless of the Clerk session. Revoking sessions and banning the Clerk user are belt-and-braces, not the control; a failed Clerk call never leaves a deactivated user with access.
- **One-time link by verified primary email.** The first sign-in links an active, unlinked `User` with that email by writing `clerkUserId` through a single conditional `updateMany` (`clerkUserId IS NULL`). Two identities racing for one row cannot both win, a linked row is never re-pointed, and afterwards the Clerk id is the identity and the email is never consulted. Admins can detach a link (the old identity's sessions are revoked first, then the link is cleared). Detaching (Reset sign-in link) is for when a person's Google/Clerk identity changed, e.g. the account was recreated; the same verified email links again on the next sign-in, so it is NOT a response to a compromised account (deactivate for that).
- **Restricted sign-up.** Clerk runs in restricted mode, Google-only, so only invited people can hold a Clerk identity at all. Invites come from Settings -> Team.
- **The portal host never reaches Clerk.** The proxy handles portal 404/rewrite/static paths before invoking `clerkMiddleware`, and both staff readers return signed out on the portal host. The client portal keeps its own identity (ADR-051).
- **Explicit authorized parties.** Session tokens are verified against `STAFF_ORIGINS` (`staffAuthorizedParties()`), shared by the middleware and `authenticateRequest`. The list never comes back empty, because Clerk treats empty as "skip the check".
- **Audit from signed webhooks.** Clerk session events are written as `type: "auth"` `ActivityLog` rows by a Svix-verified endpoint. A first sign-in's `session.created` row may have `userId` null if the webhook arrives before linking.
- **Scope is staff only.** If the portal ever moves to Clerk, use a separate Clerk application so client identities, sign-up rules and sessions cannot mix with firm members'.

**Trade-offs:**
- (+) No passwords, lockout or reset flow to maintain; Google MFA and per-device session revocation come with it
- (+) Authorization stays in one place we can test against a real DB; a provider outage or misconfiguration denies rather than grants
- (+) Deactivation takes effect immediately without a provider round trip
- (-) Runtime dependency on Clerk for sign-in; a Clerk outage blocks new sessions
- (-) First sign-in trusts Clerk's verified primary email to match a pre-created `User`; restricted sign-up and the verified-email check are what make that safe
- (-) Each request resolves Clerk id to `User` in the DB (request-cached) rather than trusting a signed claim
- (-) Origins must be configured per environment (`STAFF_ORIGINS`); a wrong list signs everyone out
