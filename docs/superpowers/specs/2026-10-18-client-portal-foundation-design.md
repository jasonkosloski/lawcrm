# Client portal: foundation (sub-project 0)

**Date:** 2026-10-18 · **Tier:** Full (new auth surface, schema, permissions, visibility)

## Intent

Clients of the firm get a secure portal where they can follow their case, exchange documents, message the matter team, and view invoices and their trust balance. Five sub-projects deliver it, each with its own spec, plan and build:

0. **Foundation** (this spec): client identity and sign-in, per-matter access, host isolation, staff invite/revoke, and an empty client shell.
1. Case status (published stage, key dates, next steps).
2. Documents (shared downloads, client uploads).
3. Messages (two-way, per matter).
4. Invoices and trust (view first; online payment later).

**What the user decided:**
- All four features belong in the portal.
- Clients sign in by email magic link; there are no client passwords. This is an approved exception to the deferred staff-auth overhaul.
- Only invited people get access, per matter.
- The portal is the same app on its own subdomain.

**Success for the foundation:**
- An invited contact gets an email and signs in with one click. They see only the matters they were invited to, and nothing else from the CRM.
- Staff can revoke a person instantly.
- No client session can reach a staff page, and no staff session works on the portal.

## Non-goals (foundation)

- Any matter content beyond name and open/closed status. Sub-projects 1–4 add the rest.
- Client self-registration, client passwords, client notifications, and payments.
- Changes to staff authentication.

## Architecture

### Routing and isolation
- Portal pages live in `src/app/(portal)/portal/...`. `PORTAL_HOST` (e.g. `portal.kosloskilaw.com`) is an extra domain on the same Vercel project.
- `src/proxy.ts`:
  - Portal host: rewrite `/x` to `/portal/x`. Allow only the portal tree, `/_next/*` static assets, `/api/csp-report` and `/api/portal/*` if added later; anything else returns 404. The staff cookie gate does not run there.
  - Staff host: `/portal/*` returns 404.
  - Local dev: `portal.localhost:3000` acts as the portal host.
- The portal session cookie is `__Host-portal_session` (HttpOnly, Secure, SameSite=Lax, Path=/, no Domain). Because it is host-only, it is never sent to the staff host. Staff Auth.js cookies are host-only on the staff host, so they are never sent to the portal.
- Portal pages get the same nonce CSP and security headers as staff pages (`src/lib/csp.ts`).

### Data model (one migration)

```prisma
model PortalIdentity {
  id         String    @id @default(cuid())
  contactId  String    @unique
  email      String    // normalized lowercase; the address invites and links go to
  disabledAt DateTime?
  createdAt  DateTime  @default(now())
  contact    Contact   @relation(fields: [contactId], references: [id], onDelete: Restrict)
  access     PortalMatterAccess[]
  tokens     PortalLoginToken[]
  sessions   PortalSession[]
  @@index([email])
}

model PortalMatterAccess {
  id          String    @id @default(cuid())
  identityId  String
  matterId    String
  invitedById String
  invitedAt   DateTime  @default(now())
  revokedAt   DateTime?
  revokedById String?
  identity    PortalIdentity @relation(fields: [identityId], references: [id], onDelete: Restrict)
  matter      Matter         @relation(fields: [matterId], references: [id], onDelete: Restrict)
  @@unique([identityId, matterId])
  @@index([matterId])
}

model PortalLoginToken {
  id         String    @id @default(cuid())
  identityId String
  tokenHash  String    @unique   // SHA-256 hex; the raw token is only ever in the email
  purpose    String    // "login" (15 min) | "invite" (7 days)
  expiresAt  DateTime
  usedAt     DateTime?
  createdAt  DateTime  @default(now())
  identity   PortalIdentity @relation(fields: [identityId], references: [id], onDelete: Cascade)
  @@index([identityId])
}

model PortalSession {
  id          String   @id @default(cuid())
  identityId  String
  tokenHash   String   @unique   // SHA-256 of the cookie value
  createdAt   DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  expiresAt   DateTime // sliding, capped at createdAt + 30 days
  identity    PortalIdentity @relation(fields: [identityId], references: [id], onDelete: Cascade)
  @@index([identityId])
}
```

- `Firm.portalEnabled Boolean @default(false)`.
- Re-inviting a revoked person clears `revokedAt` on the existing row (keeping the unique constraint) and logs a new invite.

### Access helpers: `src/lib/portal-access.ts`
- `getPortalIdentity()`: reads the cookie, looks up the session by hash, and returns the identity, or null if the session is expired, disabled, or the portal is off. Each hit slides `expiresAt` (at most once a minute), up to the cap.
- `requirePortalIdentity()`: the same, but redirects to the portal `/login` on a miss. It throws a redirect, so never wrap it in try/catch (ADR-028).
- `assertPortalMatterAccess(identityId, matterId)`: requires a live `PortalMatterAccess` row (`revokedAt` null) and otherwise returns `notFound()`. The client sees "not found" whether a matter doesn't exist or isn't theirs.
- `portalMatterWhere(identityId)`: a Prisma `where` for the matters list.
- A guard test, `src/app/(portal)/portal-guards.test.ts` (modelled on `page-guards.test.ts`), requires every portal `page.tsx` to call `requirePortalIdentity` first. The only exceptions are `login` and `auth/verify`.

### Publishing rule (binding on sub-projects 1–4)
- Nothing from a matter reaches the portal by default. Each feature adds an explicit per-item share (a flag or a publish action) that staff control, plus its own permission keys.
- Portal queries select explicit fields; they never spread a staff query's result.

### Email: `src/lib/email/`
- `sendEmail({ to, subject, text, html })` sits in front of a driver interface.
- `resend` driver (production): needs `RESEND_API_KEY` and `EMAIL_FROM`.
- `console` driver (dev and tests): logs the message, including the link.
- A test helper captures sent mail.
- Provisioned through the Vercel Marketplace (needs the user's approval when we get there). Invoice email and notifications can reuse it later.

## Sign-in flow

1. **Request a link**
   - `requestPortalLink(email)` is a server action on the portal host.
   - The page always answers "If that email has portal access, a link is on its way."
   - It sends only if an enabled identity with that email has at least one live access row and the portal is on.
   - Throttle: 3 requests per email and 20 per IP, per 15 minutes, counted from a `PortalLinkRequest` table that stores only hashed email and IP. Attempts for unknown emails are never written to the activity log (the house rule in `src/lib/auth-events.ts`).
   - Issuing a token marks the identity's earlier unused login tokens as used.
2. **Verify**
   - The email links to `/auth/verify?token=…`.
   - A GET never signs anyone in; it only shows a "Sign in" button. Mail scanners prefetch links, and a GET that signed in would burn the token.
   - The button POSTs the token to `verifyPortalLink`, which does one conditional `updateMany` (`tokenHash`, `usedAt: null`, `expiresAt > now`, `usedAt = now`). A count of 0 shows "This link has expired or was already used" with a "Send a new link" form.
   - On success it creates a `PortalSession` (32 random bytes, base64url, as the cookie value), sets the cookie and redirects to `/`.
3. **Sign out** deletes the session row and clears the cookie.
4. **Revocation**
   - Revoking an identity's last live matter access deletes all of that identity's sessions.
   - Disabling an identity, or switching the portal off firm-wide, makes `getPortalIdentity` fail closed. Disabling also deletes the sessions.

**Audit:** `ActivityLog` rows with `type: "auth"` and no staff user (`userId` null), never containing a token:
- link requested (matched identities only)
- signed in, signed out, link rejected (expired or used)
- invited, revoked: these also carry `matterId`, so they show on the matter timeline.

## Staff side

**Permission keys:**
- `portal.view`: see the Portal card.
- `portal.invite`: invite or re-invite.
- `portal.revoke`: revoke access or disable an identity.
- A data migration grants all three to every role that holds `matters.edit`. Admins bypass as usual.

**Firm switch:**
- Settings → Firm gets "Client portal enabled" (gated on the existing `firm.edit_info` key).
- While it is off, the portal host serves a "Portal unavailable" page, invites are refused, and existing sessions don't authenticate.

**Portal card** (matter Overview, needs `portal.view` plus matter access):
- Lists people with their status: invited (never signed in), active (last sign-in), revoked.
- **Invite** (`portal.invite`):
  - Pick the client or a party contact on this matter, or any contact (for a guardian or similar).
  - The contact must have an email, which can be edited before sending; the edit updates `PortalIdentity.email`, not the contact.
  - It creates or links the identity, upserts the access row, issues a 7-day invite token and emails it.
  - It refuses when the portal is off. Re-invite sends a fresh link.
- **Revoke** (`portal.revoke`) asks for confirmation and sets `revokedAt`/`revokedById`. If that was the person's last live matter, their sessions are deleted.

**Server actions** go in `src/app/actions/portal-access.ts`:
- Each one is gated with `requirePermission` plus `assertMatterAccess` (ADR-039), logged, and calls `revalidatePath`.
- Client-side portal actions are in `src/app/actions/portal-session.ts`. They are gated only by the portal session, never by staff permissions.

## Client UI (foundation)

- A mobile-first shell with the firm name and logo (`Firm.logoUrl`) and a sign-out link.
- `/` ("My matters") lists invited matters, showing name and "Open" or "Closed" (archived).
- `/matters/[id]` calls `assertPortalMatterAccess` and shows the matter name, plus "More details are coming soon" until sub-project 1.
- Other pages: `/login`, `/auth/verify`, "Portal unavailable", and a portal-styled 404.

## Error handling

- Client-facing errors are generic and never echo matter names or ids that the client doesn't have access to.
- Email send failures on invite return "Couldn't send the invite email; try again", and the access row is kept.
- Failures on link request are logged server-side; the client still sees the uniform response.

## Testing

Integration tests run against the Docker test DB:
- Tokens: single use, including two concurrent verifies (exactly one wins); expiry; invalidation of earlier tokens.
- Link request: identical response when the email is unknown, disabled, or has no live access; per-email and per-IP throttles.
- Sessions: sliding expiry and the cap; revocation (last-matter revoke and identity disable delete sessions); portal off fails closed.
- Access: `assertPortalMatterAccess` refuses matters the person was never invited to, revoked access, and nonexistent ids, all as `notFound`.
- Staff actions: permission keys, matter-access walls (a walled staff member can't invite on a hidden matter), re-invite reuses the row.

Other tests:
- Proxy: portal-host rewrite; staff paths 404 on the portal host; `/portal/*` 404s on the staff host; CSP present on portal pages.
- Guard test: every `(portal)` page calls `requirePortalIdentity`.
- Email: the console driver captures the invite and login messages; the link carries the raw token, and the database stores only its hash.

## Rollout

1. Provision Resend through the Vercel Marketplace (the user approves), then set `RESEND_API_KEY` and `EMAIL_FROM`.
2. Add `portal.<domain>` to the Vercel project and DNS (the user does this).
3. Set `PORTAL_HOST`.
4. Run the migration with `prisma migrate deploy` (the user runs it).
5. Turn on the firm switch.
6. The startup env check (`src/lib/env-check.ts`) requires `PORTAL_HOST`, `RESEND_API_KEY` and `EMAIL_FROM` in production. That is a degraded-level check, so a missing value is logged and nothing is blocked.

## Docs and decisions

- New `docs/features/client-portal.md` (feature file plus ROADMAP line).
- **ADR:** "Client portal identity is separate from staff auth (magic link, database sessions, host-isolated cookie)". It records the exception to the auth deferral, and why tokens are POST-confirmed. Use the next free ADR number at implementation time; ADR-049 is reserved by the restricted-intake-walls work.
- `docs/PERMISSIONS.md` gets the portal keys section.
- `docs/ARCHITECTURE.md` gets the host routing and the `(portal)` route group.

## Open risks

- Email deliverability: SPF/DKIM for the sending domain must be set up with Resend before go-live, or invites land in spam.
- One codebase serves both hosts, so isolation rests on proxy routing and host-only cookies. The proxy and guard tests are what keep it that way.
- Contact merges: `PortalIdentity.contactId` is unique. `mergeContacts` must re-point or merge identities. The plan covers this with a test.
