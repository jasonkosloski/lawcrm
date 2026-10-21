# Notification Email Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email staff their in-app notifications via Resend, per category (Off / Instant / Daily digest) with per-matter mute, configured on `/settings/notifications`.

**Architecture:** Outbox on the `Notification` row (`emailState`). A 5-minute Vercel cron drains `pending` rows under an advisory lock, runs a pure decision function per row (send / hold / skip), sends instant emails through `sendEmail()`, and once per local day after 07:00 sends each user one digest of held rows.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before route/page code), Prisma/Postgres, Vitest, existing `src/lib/email/send.ts` Resend driver.

**Spec:** `docs/superpowers/specs/2026-10-21-notification-email-design.md`

## Global Constraints

- Migration is expand-only (ADR-058: prod build auto-applies migrations). No drops, no renames.
- Every pre-existing `notifications` row ends `emailState = 'skipped'`; new rows default `'pending'`.
- Categories and labels, exactly: `deadlines` Deadlines, `tasks` Tasks, `settlement` Settlement approvals, `billing` Billing, `matter_team` Matter team, `portal` Client portal, `other` Other.
- Modes: `off | instant | digest`. Default (no row) = `instant`. `deadlines` never `off`; matter mute never suppresses `deadlines`.
- Digest hour: 07:00 in `User.timeZone`. Retry cap: 3 attempts, then `failed`. Batch cap: 200 rows per run.
- Matter access re-checked at send time with `canAccessMatter(userId, matterId)` (`src/lib/matter-access.ts`), never a bare `matterId` query.
- Settings and mute are identity-scoped: no permission key; private view state like matter pins, so not activity-logged.
- Dates: digest day stored as a UTC-midnight date-only value (ADR-012); compute with `todayKey(tz)` / `parseDateOnly` from `src/lib/format-date.ts`.
- Test DB required: `docker compose -f docker-compose.test.yml up -d`. Commit with explicit pathspec: `git commit -m "…" -- <paths>`.

## Review Focus

1. A notification read in the app before the worker runs: no email. Test in Task 4 (`skips a row already read`).
2. Two overlapping cron runs: each row emailed once. Test in Task 4 (`concurrent runs send once`).
3. User has no email-preference rows at all (every existing user on day one): behaves as all-Instant. Test in Task 4 (`no preference rows means instant`).
4. User changes a category to Off while rows are held for the digest: those rows are skipped, not sent in the digest. Test in Task 4 (`digest re-decides held rows`).
5. Notification titles/bodies containing `<`, `&` or quotes (matter names like "Smith & Sons <LLC>"): escaped in HTML, raw in text. Test in Task 3 (`escapes html`).

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (model `Notification` ~L2194, `User` ~L48, `Matter`, new models near `UserMatterPin` ~L543)
- Create: `prisma/migrations/<timestamp>_notification_email/migration.sql` (via prisma)
- Modify: `src/test/integration-helpers.ts` (`TABLES_IN_DELETE_ORDER`, before `"notifications"` / `"user_matter_pins"`)

**Interfaces:**
- Produces: `Notification.emailState String @default("pending")`, `emailAttempts Int @default(0)`, `emailedAt DateTime?`, `@@index([emailState, createdAt])`; `User.notificationDigestSentOn DateTime? @db.Date`; `NotificationPreference { id String @id @default(cuid()), userId, category String, emailMode String, updatedAt DateTime @updatedAt, @@unique([userId, category]), @@map("notification_preferences") }`; `NotificationMatterMute { userId, matterId, createdAt, @@id([userId, matterId]), @@index([matterId]), @@map("notification_matter_mutes") }`, both cascading on user/matter delete. Prisma clients: `prisma.notificationPreference`, `prisma.notificationMatterMute`.

- [ ] **Step 1:** Edit the schema as above (doc comments in the file's `///` style; update the `Notification.type` doc list to include `portal_upload | portal_message`).
- [ ] **Step 2:** `printenv | grep -i database` to confirm no prod URL is exported, then `npx prisma migrate dev --name notification_email --create-only`.
- [ ] **Step 3:** Append to the generated SQL: `UPDATE "notifications" SET "emailState" = 'skipped';` (after the `ADD COLUMN`).
- [ ] **Step 4:** `npx prisma migrate dev` then `npm run check:migrations`. Expected: applies cleanly, check passes (no destructive statements).
- [ ] **Step 5:** Add `"notification_preferences"`, `"notification_matter_mutes"` to `TABLES_IN_DELETE_ORDER` before `"notifications"`. Run `npx vitest run src/app/actions/matter-pins.test.ts` — expected PASS (reset still works).
- [ ] **Step 6:** Commit `prisma/schema.prisma prisma/migrations/<dir> src/test/integration-helpers.ts` — `feat(notifications): email outbox and preference schema`.

### Task 2: Categories and decision policy

**Files:**
- Create: `src/lib/notification-categories.ts`, `src/lib/notification-categories.test.ts`
- Create: `src/lib/notification-email-policy.ts`, `src/lib/notification-email-policy.test.ts`

**Interfaces:**
- Consumes: `NotificationType` from `src/lib/notifications.ts`.
- Produces:
  - `type NotificationCategory = "deadlines" | "tasks" | "settlement" | "billing" | "matter_team" | "portal" | "other"`
  - `type EmailMode = "off" | "instant" | "digest"`
  - `NOTIFICATION_CATEGORIES: readonly { key: NotificationCategory; label: string; description: string; modes: readonly EmailMode[]; honoursMute: boolean }[]` (display order as in Global Constraints)
  - `CATEGORY_BY_TYPE: Record<NotificationType, NotificationCategory>`
  - `categoryOf(type: string): NotificationCategory` (unknown → `"other"`)
  - `isAllowedMode(category: NotificationCategory, mode: string): mode is EmailMode`
  - `effectiveMode(category, stored: string | undefined): EmailMode` (undefined or disallowed → `"instant"`)
  - `decideEmail(i: { userActive: boolean; read: boolean; hasMatterAccess: boolean; category: NotificationCategory; mode: EmailMode; muted: boolean }): "send" | "hold" | "skip"` — order: inactive → skip; read → skip; !hasMatterAccess → skip; mode off → skip; muted && honoursMute → skip; digest → hold; else send. (`hasMatterAccess` is `true` for rows with no matter.)

- [ ] **Step 1: Failing tests.** `notification-categories.test.ts`: `maps every type` (each `NotificationType` from a literal list → expected category per spec table); `unknown type is other`; `deadlines disallow off` (`isAllowedMode("deadlines","off") === false`, `isAllowedMode("tasks","off") === true`, `isAllowedMode("tasks","weekly") === false`); `effectiveMode coerces` (`effectiveMode("deadlines","off") === "instant"`, `effectiveMode("tasks",undefined) === "instant"`). `notification-email-policy.test.ts`: table test with one case per rule above, plus `mute does not skip deadlines` → `"send"`, and `deadline digest holds` → `"hold"`.
- [ ] **Step 2:** `npx vitest run src/lib/notification-categories.test.ts src/lib/notification-email-policy.test.ts` — FAIL (modules missing).
- [ ] **Step 3:** Implement both modules (pure; no `server-only`, no Prisma). Descriptions are one short sentence each, e.g. Deadlines: "Reminders 7 days, 1 day and on the day a deadline is due, and when it is overdue."
- [ ] **Step 4:** Re-run — PASS.
- [ ] **Step 5:** Commit the four files — `feat(notifications): email categories and decision policy`.

### Task 3: Email renderers

**Files:**
- Create: `src/lib/notification-emails.ts`, `src/lib/notification-emails.test.ts`

**Interfaces:**
- Consumes: `OutgoingEmail` (`src/lib/email/drivers.ts`), `NOTIFICATION_CATEGORIES`, `categoryOf` (Task 2), `staffAppBaseUrl()` (below).
- Produces:
  - `staffAppBaseUrl(): string | null` — first entry of `STAFF_ORIGINS`, trimmed, no trailing slash (reuse the parsing in `src/lib/staff-authorized-parties.ts` if it exports one; otherwise add and export a small parser there and use it from `src/lib/clerk-admin.ts` too).
  - `type EmailItem = { title: string; body: string | null; link: string | null; type: string }`
  - `instantNotificationEmail(item: EmailItem, baseUrl: string): Omit<OutgoingEmail, "to">`
  - `digestNotificationEmail(items: EmailItem[], baseUrl: string): Omit<OutgoingEmail, "to">`

Copy (exact): instant subject = item title; button "Open in LitGox"; footer "Change email notification settings" → `${baseUrl}/settings/notifications`. Digest subject: `Your daily summary: ${n} notification${n === 1 ? "" : "s"}`; one `<h2>` per category label in `NOTIFICATION_CATEGORIES` order, empty categories omitted. Relative links are prefixed with `baseUrl`; an item with no link renders no button/anchor.

- [ ] **Step 1: Failing tests:** `instant uses title as subject`; `absolute link` (link `/matters/m1` → html contains `https://app.test/matters/m1`); `no link no button`; `escapes html` (title `Smith & Sons <LLC> "x"` → html contains `Smith &amp; Sons &lt;LLC&gt; &quot;x&quot;`, text contains raw title); `digest groups by category in order` (a task item and a deadline item → Deadlines heading appears before Tasks); `digest subject pluralises`; `footer links to settings`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. Reuse the `esc` shape from `src/lib/portal/emails.ts` (move it to `src/lib/email/escape.ts` and import in both, keeping portal tests green).
- [ ] **Step 4:** `npx vitest run src/lib/notification-emails.test.ts src/lib/portal` — PASS.
- [ ] **Step 5:** Commit — `feat(notifications): instant and digest email templates`.

### Task 4: Delivery worker

**Files:**
- Create: `src/lib/notification-email.ts`, `src/lib/notification-email.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `sendEmail` (`src/lib/email/send.ts`); `canAccessMatter` (`src/lib/matter-access.ts`); `todayKey`, `parseDateOnly`, `dateOnlyKey` (`src/lib/format-date.ts`); `captureEmails()` (`src/test/email-capture.ts`) in tests.
- Produces:
  - `const NOTIFICATION_EMAIL_DIGEST_HOUR = 7`, `NOTIFICATION_EMAIL_MAX_ATTEMPTS = 3`, `NOTIFICATION_EMAIL_BATCH = 200`
  - `runNotificationEmailDelivery(now?: Date): Promise<{ sent: number; skipped: number; held: number; failed: number; digests: number }>`

Algorithm (one `prisma.$transaction` holding `pg_advisory_xact_lock(<new constant key, e.g. 7_302_027>)`, timeout ~55 s; sends happen inside it so a concurrent run waits and then sees the stamped rows):
1. Load up to 200 `pending` rows oldest first with `user { email, isActive, timeZone, notificationDigestSentOn }`.
2. Bulk-load prefs and mutes for the distinct user ids. Memoise `canAccessMatter` per `userId:matterId`.
3. Per row: `decideEmail`. `skip` → `emailState='skipped'`. `send` → `sendEmail`; ok → `sent` + `emailedAt=now`; else `emailAttempts+1`, `failed` once it reaches 3. `hold` → leave.
4. Digest pass: users with any `pending` row (not limited to the batch) whose local hour ≥ 7 (`Intl.DateTimeFormat` hour in `timeZone`) and `notificationDigestSentOn` key < `todayKey(tz, now)`: load their pending rows, re-decide each; skips stamped `skipped`; `send`-decided rows (category switched to instant) are sent individually; remaining `hold` rows go in one digest. Success → rows `sent`, user `notificationDigestSentOn = parseDateOnly(todayKey)`. Failure → nothing stamped.
5. No staff base URL (`staffAppBaseUrl()` null): log once, leave everything pending, return zeros.

- [ ] **Step 1: Failing integration tests** (seed with `seedFirm`/`seedUser`/`seedMatter`, rows via `prisma.notification.create`, `captureEmails()` for sends, `process.env.STAFF_ORIGINS = "https://app.test"`, fixed `now`):
  - `sends instant and stamps sent` — 1 email to the user's address, row `sent`, `emailedAt` set.
  - `no preference rows means instant`.
  - `off skips` (tasks off → `skipped`, 0 emails).
  - `deadline off is coerced to instant` (stored `deadlines/off` → sent).
  - `matter mute skips tasks but not deadlines`.
  - `skips a row already read`.
  - `skips inactive user`.
  - `skips when matter access lost` (firm `matterVisibility: "TEAM"`, user not on team).
  - `skipped rows are never picked up` (row created `emailState: "skipped"` → untouched, 0 emails).
  - `retries then fails` (driver returning `{ok:false}` via `__setDriverForTests`; three runs → `emailAttempts 3`, `failed`).
  - `digest holds before 07:00 local` (now = 06:30 America/Denver → 0 emails, row pending).
  - `digest sends once per day` (07:30 → 1 email with both held rows, rows `sent`; second run same day → 0 emails; a new held row the same day stays pending).
  - `digest re-decides held rows` (hold, then set category off → run at 07:30 → `skipped`, 0 emails).
  - `concurrent runs send once` (`Promise.all([run(), run()])` → 1 email).
- [ ] **Step 2:** `npx vitest run src/lib/notification-email.integration.test.ts` — FAIL.
- [ ] **Step 3:** Implement `runNotificationEmailDelivery` per the algorithm, with a header comment in the style of `src/lib/notification-sweeps.ts` (outbox, lock, idempotency, digest).
- [ ] **Step 4:** Re-run — PASS. Also `npx vitest run src/lib/notification-sweeps` — PASS (sweep rows now default pending; nothing else changes).
- [ ] **Step 5:** Commit both files — `feat(notifications): email delivery worker`.

### Task 5: Cron route

**Files:**
- Create: `src/app/api/notification-email/route.ts`
- Modify: `vercel.json` (add `{ "path": "/api/notification-email", "schedule": "*/5 * * * *" }`), `src/proxy.ts:64-65` (exempt list), `src/vercel-config.test.ts:43-45`
- Test: `src/app/api/notification-email/route.test.ts`

**Interfaces:**
- Consumes: `isAuthorizedCron` (`src/lib/cron-auth.ts`), `runNotificationEmailDelivery` (Task 4).
- Produces: `GET(request: Request): Promise<Response>`; `export const maxDuration = 60`.

- [ ] **Step 1: Failing tests:** route test mocks `@/lib/notification-email`: `rejects without bearer` (401, worker not called); `runs with bearer` (200 JSON with the worker's counts); `worker throw returns 500 and logs` (never an unhandled rejection). Extend `vercel-config.test.ts` expected cron + proxy-exempt lists with `/api/notification-email`.
- [ ] **Step 2:** `npx vitest run src/app/api/notification-email src/vercel-config.test.ts` — FAIL.
- [ ] **Step 3:** Implement the route mirroring `src/app/api/notification-sweep/route.ts` (same header comment shape naming the sanctioned system-endpoint exception); edit `vercel.json` and `src/proxy.ts`.
- [ ] **Step 4:** Re-run — PASS.
- [ ] **Step 5:** Commit — `feat(notifications): schedule email delivery cron`.

### Task 6: Preference actions

**Files:**
- Create: `src/app/actions/notification-preferences.ts`, `src/app/actions/notification-preferences.test.ts`
- Create: `src/lib/queries/notification-preferences.ts` (reads for the settings page and matter header)

**Interfaces:**
- Consumes: Task 2 (`isAllowedMode`, `NOTIFICATION_CATEGORIES`), `getCurrentUserId`, `assertMatterAccess`.
- Produces:
  - `setNotificationEmailMode(category: string, mode: string): Promise<{ ok: true } | { ok: false; error: string }>` — zod-validates category ∈ keys and `isAllowedMode`; upsert on `userId_category`; `revalidatePath("/settings/notifications")`.
  - `setMatterEmailMute(matterId: string, muted: boolean): Promise<{ ok: boolean; muted: boolean; error?: string }>` — mirrors `setMatterPin` (`src/app/actions/matter-pins.ts`): `assertMatterAccess` outside try when muting; `createMany skipDuplicates` / `deleteMany`; revalidate `/settings/notifications` and `/matters/${matterId}`.
  - `getNotificationEmailSettings(userId: string): Promise<{ modes: Record<NotificationCategory, EmailMode>; mutedMatters: { id: string; name: string }[] }>` — `modes` via `effectiveMode`; `mutedMatters` filtered with `matterAccessWhere(userId)`, sorted by name.
  - `isMatterEmailMuted(userId: string, matterId: string): Promise<boolean>`

- [ ] **Step 1: Failing tests** (integration, mock `next/cache` and `@/lib/current-user` like `matter-pins.test.ts`): `saves a mode`; `rejects unknown category`; `rejects deadlines off`; `mute and unmute idempotent`; `mute requires matter access` (TEAM visibility, not on team → throws not-found); `settings defaults to instant for every category`; `muted list hides matters the user can no longer see`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. File header notes these are private per-user settings, not logged (pin precedent).
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit — `feat(notifications): email preference and matter mute actions`.

### Task 7: Settings page

**Files:**
- Modify: `src/app/(dashboard)/settings/notifications/page.tsx` (replace placeholder)
- Create: `src/components/settings/notification-email-settings.tsx`, `src/components/settings/notification-email-settings.test.tsx`

**Interfaces:**
- Consumes: `getNotificationEmailSettings`, `setNotificationEmailMode`, `setMatterEmailMute` (Task 6); `NOTIFICATION_CATEGORIES` (Task 2).
- Produces: `NotificationEmailSettings({ modes, mutedMatters, timeZone }: { modes: Record<NotificationCategory, EmailMode>; mutedMatters: { id: string; name: string }[]; timeZone: string })` client component.

Layout: page calls `requireUser()` first (ADR-028). Intro line: "Everything still appears in the bell. Choose what also reaches your email." One row per category: label, description, segmented radiogroup (Off / Instant / Daily digest; follow `src/components/dashboard/split-picker.tsx` styling and UI_PATTERNS button sizes). Deadlines row omits Off and shows "Deadline reminders can't be turned off." Digest note under the list: `Daily digests arrive at 7:00 AM (${timeZone}).` "Muted matters" section: each row links to the matter with an Unmute button; empty state "No muted matters. Mute one from the bell icon on its page." Changes are optimistic with `notifyError` on failure, like `PinToggle`.

- [ ] **Step 1: Failing component tests** (mock the actions): `renders a row per category`; `deadlines has no off option`; `choosing digest calls setNotificationEmailMode("tasks","digest")`; `failure reverts and notifies`; `unmute calls setMatterEmailMute(id,false)`; `empty muted state`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement component and page (page reads user `timeZone` from Prisma). Confirm `src/app/page-guards.test.ts` still passes.
- [ ] **Step 4:** `npx vitest run src/components/settings/notification-email-settings.test.tsx src/app/page-guards.test.ts` — PASS. Run the app (`run` skill) and check `/settings/notifications` renders and saves.
- [ ] **Step 5:** Commit — `feat(notifications): email settings page`.

### Task 8: Matter header mute toggle

**Files:**
- Create: `src/components/matters/email-mute-toggle.tsx`, `src/components/matters/email-mute-toggle.test.tsx`
- Modify: `src/app/(dashboard)/matters/[id]/layout.tsx:119-122` (render beside `PinToggle`)

**Interfaces:**
- Consumes: `setMatterEmailMute`, `isMatterEmailMuted` (Task 6).
- Produces: `EmailMuteToggle({ matterId, initialMuted }: { matterId: string; initialMuted: boolean })`.

Mirror `src/components/matters/pin-toggle.tsx`: `Bell` / `BellOff` icons, `aria-pressed`, label/title "Mute email notifications for this matter" / "Unmute email notifications for this matter", tooltip notes deadline reminders still arrive.

- [ ] **Step 1: Failing tests:** `shows BellOff when muted`; `click calls setMatterEmailMute(id,true)`; `failure notifies` (mirror `pin-toggle.test.tsx`).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; in the layout fetch `isMatterEmailMuted(userId, matter.id)` in the existing parallel wave.
- [ ] **Step 4:** Run — PASS; check the matter page in the running app.
- [ ] **Step 5:** Commit — `feat(notifications): mute matter email from the header`.

### Task 9: Docs and cleanup

**Files:**
- Modify: `docs/features/notifications.md`, `docs/ROADMAP.md` (notification delivery line), `src/lib/notifications.ts` header comment ("Future: when we add email…" → describe the outbox), `docs/SCHEMA_NOTES.md` (one line: `emailState` outbox; pre-feature rows backfilled `skipped`)
- Delete: `docs/superpowers/specs/2026-10-21-notification-email-design.md`, `docs/superpowers/plans/2026-10-21-notification-email.md`

- [ ] **Step 1:** Feature file: add a shipped "Email delivery" bullet (outbox, categories, digest at 07:00 local, mute, deadline guard, cron path); open work keeps SMS/push, quiet hours, digest hour choice, bounce webhooks. ROADMAP line → `[~] **Notification delivery channels**: email shipped (instant/digest, per-category, matter mute); SMS/push left.`
- [ ] **Step 2:** `npm test` — all PASS.
- [ ] **Step 3:** Commit docs + deletions — `docs(notifications): email delivery shipped`. Then run `/code-review` on the range and push to main once green.
