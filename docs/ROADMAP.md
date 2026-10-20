# Roadmap

What's next, in priority order. One line per item; the detail (scope,
what's done, follow-ups) lives in the linked feature file. Update the
feature file and this line in the same commit.

Status: `[ ]` planned · `[~]` in progress · `[x]` shipped · `[-]` descoped

## Where we are

Past MVP feature-completeness: a solo lawyer can run a practice on what's
shipped (intake → matter → time → billing → trust → settlement, with
calendar, deadlines, tasks, notes, documents, records requests, contacts,
Gmail, audit log, granular permissions, matter-team access and restricted intake). Production
runs on Prisma Postgres + Vercel Blob. Remaining work clusters around
external integrations (SMS, voicemail, notification delivery), polish, and
tech-debt sweeps. Everything shipped is listed per area in
[`features/`](features/).

Caveats worth knowing: matter-team access ships OFF (firm switch defaults to
"Everyone"; see [matter-access](features/matter-access.md)), and invoice
"send" is logged only ([issue](issues/invoice-email-not-sent.md)).

## P1: next up

- [~] **Clerk staff auth**: Google sign-in via Clerk shipped on branch `clerk-staff-auth`; production cutover pending, then drop-migration and Microsoft sign-in. → [auth](features/auth.md)
- [~] **Notification delivery channels**: email/SMS/push fan-out from `createNotification`; per-matter preferences. → [notifications](features/notifications.md)
- [~] **Phone / SMS / voicemail**: manual call logging shipped; SMS send and voicemail transcription need providers. → [calls](features/communication-calls.md)
- [~] **`/matters/new` v2**: name pattern, case location, multi-team, conflict pre-save, retainer, drafts. → [matters](features/matters.md)
- [~] **Client portal**: foundation and documents shipped; status, messages, invoices next. → [client-portal](features/client-portal.md)
- [ ] **Calendar: recurring events**: blocked on an RRULE data-model ADR (series vs materialized). → [calendar](features/calendar.md)
- [ ] **Email: attachments on send**: receive side shipped. → [email](features/communication-email.md)
- [ ] **Email: per-user signatures**: `getEmailSignature()` seam ready; needs lookup + sanitizing. → [email](features/communication-email.md)
- [ ] **Template follow-ups**: rich-text/DOCX output, per-practice-area defaults, template versioning. → [documents](features/documents.md)
- [~] **Search follow-ups**: within-list keyword filters; Postgres FTS when ILIKE stops scaling. → [search](features/search.md)

## P2: polish and follow-ups

**Matters, intake, records**
- [~] **Matter header "Create" menu**: only Note/Event have quick forms; others link to tabs. → [matters](features/matters.md)
- [ ] **Matters list: Cards view**: third mode beside Table and Kanban. → [matters](features/matters.md)
- [ ] **Intake queue: split-view reader pane** → [intake](features/intake.md)
- [ ] **Lead scoring deep dive**: nothing computes scores yet. → [intake](features/intake.md)
- [ ] **New intake form leftovers**: phone matching, initial stage, coordinator assignment. → [intake](features/intake.md)
- [ ] **Lead-scoped expenses**: needs a lead column on Expense, `matterId` relaxed, conversion roll-forward. → [intake](features/intake.md)
- [ ] **Capture task/event from the intake note composer** → [intake](features/intake.md)
- [ ] **Records follow-ups**: per-item completeness, HIPAA auth expiry, holiday-aware business days, email/fax send, PDF/DOCX letters, firm-wide `/records` page. → [records-requests](features/records-requests.md)

**Calendar and sync**
- [ ] **Calendar visibility v2**: view another user's calendar through the visibility resolver. → [calendar](features/calendar.md)
- [ ] **Calendar: real RSVP statuses; reassign existing events to a matter** → [calendar](features/calendar.md)
- [ ] **Google sync: `CalendarEvent.origin` + `EmailAccount.backfillBefore`**: safe cleanup of Google-born events and an explicit backfill anchor (schema change). → [issue](issues/google-sync-origin-and-backfill-anchor.md)
- [ ] **Google Calendar: attendee fan-out push, delete retry, skipped-event acknowledgement** → [google-calendar-sync](features/google-calendar-sync.md)

**Email**
- [ ] **Email polish**: load-remote-images opt-in, store Message-ID/References, archive/star in reader header + touch affordances, attachment FK on Document + bulk file-all, thread-wide star writeback. → [email](features/communication-email.md)

**Time, billing, money**
- [ ] **Invoice email delivery**: "send" is logged only. → [issue](issues/invoice-email-not-sent.md)
- [ ] **Settings: Billing & rates**: default rate, UTBMS library, invoice templates, payment terms. → [time-and-billing](features/time-and-billing.md)
- [ ] **`updateExpense` edit dialog**: action exists, no UI. → [time-and-billing](features/time-and-billing.md)
- [ ] **Time follow-ups**: auto-capture, idle detection, admin user picker on `/time`, editable reconciliation lanes. → [time-and-billing](features/time-and-billing.md)

**Documents**
- [ ] **Document metadata edit**: rename/re-categorize needs a `documents.edit` key. → [issue](issues/document-metadata-edit.md)
- [ ] **Document versioning** → [documents](features/documents.md)
- [ ] **Firm-wide document library**: cross-matter folder tree, file grid, category filters. → [documents](features/documents.md)
- [ ] **Export / print to PDF beyond invoices**: demand letters, trust reports. → [documents](features/documents.md)
- [ ] **Viewer follow-ups**: transcripts, OCR into search, legacy .doc, docx visual check. → [documents](features/documents.md)
- [~] **Evidence review follow-ups**: transcripts, OCR, multi-track sync, Evidence-model ingestion, quote index. → [evidence-review](features/evidence-review.md)

**Shell, settings, automations**
- [~] **Command palette v2 leftovers**: fuzzy highlight, New task, Log a call, Start timer. → [app-shell](features/app-shell.md)
- [ ] **Dashboard layout v3**: drag + resize, per-card width, role defaults. → [app-shell](features/app-shell.md)
- [ ] **Role-based & customizable sidebar**: needs UserPreferences. → [app-shell](features/app-shell.md)
- [ ] **Reports follow-ups**: date-range picker, CSV export, per-user drill-down. → [reports](features/reports.md)
- [~] **Automations follow-ups**: due dates relative to a deadline, stage-change trigger, notifications for auto-created tasks. → [deadlines-and-tasks](features/deadlines-and-tasks.md)
- [~] **Settings: Integrations**: Westlaw, e-sign, IOLTA bank feed, PACER. → [settings-admin](features/settings-admin.md)

**Tech debt**
- [ ] **Gate reads that only have session guards**: template preview (contacts export now needs `contacts.export`). → [issue](issues/ungated-reads.md)
- [ ] **Server-side email validation** on contact/party/attendee schemas. → [platform-quality](features/platform-quality.md)
- [ ] **Button size convention + one sweep** → [platform-quality](features/platform-quality.md)
- [ ] **Opportunistic sweeps**: EmptyState, `plural()`, status-label maps as files are touched. → [platform-quality](features/platform-quality.md)

## Deferred


Nothing currently deferred.
