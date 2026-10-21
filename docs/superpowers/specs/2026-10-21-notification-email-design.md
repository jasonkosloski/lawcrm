# Notification email delivery: design

Status: approved in chat 2026-10-21. Working file; fold into
`docs/features/notifications.md` and delete when shipped.

## Goal
Staff get in-app notifications by email too, via Resend, so a deadline
reminder or an assigned task reaches them without opening the app. Each
user controls email per category (Off / Instant / Daily digest) and can
mute email for individual matters. Deadline reminders can never be fully
silenced.

## Decisions
- Cadence: per-event (Instant) by default; any category can switch to a
  once-a-day digest at 07:00 in the user's profile time zone.
- Granularity: per category, plus per-matter email mute.
- Defaults: every category Instant. Deadlines allow Instant or Digest
  only, and a matter mute does not suppress deadlines (malpractice guard).
- Out of scope: SMS, push, quiet hours, configurable digest hour, Resend
  bounce/complaint webhooks, firm-wide admin defaults.

## Approach: outbox on the Notification row
Email state lives on each `Notification` row. A cron worker drains
pending rows. This covers every producer, including the deadline sweep,
which inserts rows directly in its own transaction rather than through
`createNotification`. Writers do not change except that new rows start
`pending` (column default). Rejected: sending inline from the writers
(adds Resend latency to user actions, no retry, sweep needs a copy, digest
still needs a cron) and Vercel Queues (unneeded at this volume).

## Data (one expand-only migration)
- `Notification.emailState String @default("pending")`:
  `pending | sent | skipped | failed`. Migration sets every existing row
  to `skipped` so history is never emailed. Index on
  `(emailState, createdAt)` for the worker scan.
- `Notification.emailAttempts Int @default(0)`,
  `Notification.emailedAt DateTime?`.
- `NotificationPreference { id, userId, category String, emailMode
  String, updatedAt }`, `@@unique([userId, category])`. No row = Instant.
- `NotificationMatterMute { userId, matterId, createdAt }`,
  `@@id([userId, matterId])` (like `UserMatterPin`), cascades on
  user/matter delete.
- `User.notificationDigestSentOn DateTime? @db.Date`: the local calendar
  day (ADR-012 UTC-midnight) the last digest went out.

## Categories (`src/lib/notification-categories.ts`)
A `Record<NotificationType, NotificationCategory>` so a new type without
a category is a compile error. Unknown DB strings fall back to `other`.

| Category | Label | Types |
|---|---|---|
| `deadlines` | Deadlines | deadline_approaching, deadline_overdue |
| `tasks` | Tasks | task_assigned, task_due_soon |
| `settlement` | Settlement approvals | settlement_step_approved, settlement_step_rejected |
| `billing` | Billing | invoice_payment_recorded |
| `matter_team` | Matter team | matter_assigned |
| `portal` | Client portal | portal_upload, portal_message |
| `other` | Other | note_mentioned, generic |

Also exports the allowed modes per category (`deadlines` excludes `off`)
and whether matter mute applies (`deadlines`: no).

## Decision function (pure, `src/lib/notification-email-policy.ts`)
`decideEmail({ row, user, mode, muted, hasMatterAccess }) ->
"send" | "hold" | "skip"`:
1. user inactive -> skip
2. row already read (`readAt` set) -> skip
3. row's matter set and caller lost access -> skip
4. mode `off` (coerced to `instant` for deadlines) -> skip
5. matter muted and category honours mute -> skip
6. mode `digest` -> hold; mode `instant` -> send

## Worker (`src/lib/notification-email.ts` + `/api/notification-email`)
- Route: GET, `isAuthorizedCron`, mirrors `/api/notification-sweep`;
  `vercel.json` cron `*/5 * * * *`; proxy exemption for the exact path;
  `src/vercel-config.test.ts` extended.
- Runs under `pg_advisory_xact_lock` (own key) so overlapping runs take
  turns. Processes pending rows oldest first, batch cap 200 per run.
- Loads recipients (email, isActive, timeZone, digest day), their
  preferences and mutes in bulk; checks matter access per (user, matter)
  with `matterAccessWhere`, so ethical walls hold at send time.
- Instant: `sendEmail` one row -> `sent` + `emailedAt`. Failure ->
  `emailAttempts++`; at 3 attempts -> `failed`.
- Skip -> `skipped`. Hold -> left `pending`.
- Digest pass: for each user with held rows whose local time is >= 07:00
  and `notificationDigestSentOn` < local today: re-run the decision on
  each held row (state may have changed), send one email grouped by
  category, mark included rows `sent`, set `notificationDigestSentOn`.
  On failure leave rows pending and do not set the day (retry next tick).
- Fire-and-forget: a failure logs and never throws out of the route.

## Email content (`src/lib/notification-emails.ts`)
- Instant: subject = notification title; body = title, optional body
  line, "Open in LitGox" button to the absolute link (staff origin from
  `STAFF_ORIGINS`, first entry), footer "Change email notification
  settings" -> `/settings/notifications`. Text and HTML, HTML-escaped.
- Digest: subject "Your daily summary: N notifications"; sections per
  category, each item title + body + link; same footer.
- Staff emails go to the firm's own staff address, so matter names in
  titles are acceptable (unlike portal client emails).

## Settings UI
- `/settings/notifications` (identity-scoped, `requireUser()`, no
  permission key; like Settings -> Security): replaces the placeholder.
  One row per category with an Off / Instant / Daily digest segmented
  control (Deadlines shows Instant / Daily digest plus a one-line note on
  why). Copy explains the 07:00 digest in the profile time zone.
  "Muted matters" section lists mutes with Unmute buttons.
- Matter header: a Bell/BellOff icon toggle beside `PinToggle` (the
  header has no actions menu), "Mute email notifications for this matter".
- Actions in `src/app/actions/notification-preferences.ts`:
  `setNotificationEmailMode(category, mode)` (validates category and
  allowed mode with zod), `setMatterEmailMute(matterId, muted)`
  (`assertMatterAccess` first). Not activity-logged: private per-user
  view state, same precedent as matter pins. Both `revalidatePath` the
  settings page (and the matter for mute).

## Testing
- Unit: category map completeness, allowed modes, `decideEmail` table.
- Unit: email renderers (escaping, absolute links, digest grouping).
- Integration (test DB, `captureEmails()`): instant send; off skip;
  deadline off coerced to send; mute skips non-deadline but not
  deadline; access loss skips; inactive skips; read skips; retry ->
  failed after 3; digest holds until 07:00 local and sends once per day;
  migration backfill (rows created before are not emailed: covered by
  default test of `skipped` rows not picked up).
- Action tests: mode validation, deadline `off` rejected, mute requires
  matter access.

## Docs
Feature file `docs/features/notifications.md` (shipped section + open
work), ROADMAP line, PERMISSIONS note not needed (identity-scoped).
Env: no new vars (`RESEND_API_KEY`, `EMAIL_FROM`, `STAFF_ORIGINS`,
`CRON_SECRET` already exist).
