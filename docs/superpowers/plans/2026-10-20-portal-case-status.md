# Portal Case Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients see staff-written status updates and staff-shared calendar events on their portal matter page; staff post updates and share events from the matter.

**Architecture:** Two new portal-only tables (`PortalStatusUpdate`, `PortalSharedEvent`). One server-only reader in `src/lib/portal/status.ts` gated by `portalMatterWhere`. Staff actions in `src/app/actions/portal-status.ts` follow `portal-documents.ts` (permission result → `assertMatterAccess` outside try/catch → write → email → `logActivity` → revalidate).

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before Next-specific code), Prisma 7 / Postgres, Zod, Vitest + happy-dom, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-20-portal-case-status-design.md`

## Global Constraints

- `stageLabel` max 60 chars, `body` max 4,000, `clientTitle` max 200, `clientNote` max 2,000; all trimmed, plain text, rendered as text with line breaks preserved (`whitespace-pre-line`), never as HTML.
- Portal zone for "upcoming vs past": `America/Denver` (same constant pattern as `src/lib/portal/requests.ts`).
- Portal reads never select `CalendarEvent.title` or `CalendarEvent.description`.
- A share is visible only when `event.matterId === share.matterId`.
- Emails never include update text; link to `portalHomeUrl()`. Editing never re-sends.
- Permission keys exactly: `portal.add_updates`, `portal.edit_updates`, `portal.delete_updates`, `portal.share_events`.
- Migration is expand-only (ADR-058; ships to prod on commit). Never run Prisma against a non-local DB; check `printenv | grep -i database` first.
- Commit with explicit pathspec: `git commit -m "…" -- <paths>`; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests need `docker compose -f docker-compose.test.yml up -d`.

## Review Focus

1. Event re-filed to another matter (or unfiled) after sharing → hidden on both matters' portals, and the staff side shows it as not shared on the new matter. Test in Task 2 and Task 4.
2. Staff edits an update after it was emailed → no second email, `emailedAt` unchanged, `editedAt` set. Test in Task 3.
3. Portal off at post time with "email" ticked → update saved, no email, `emailedAt` null, action still `ok`. Test in Task 3.
4. Sharing a lead event (`matterId` null) or an event on a walled matter → refused with not-found, nothing written. Test in Task 4.
5. All-day shared event on today's date (Denver) → listed under Upcoming, not Past, all day long. Test in Task 2.

---

### Task 1: Schema, migration, permission keys

**Files:**
- Modify: `prisma/schema.prisma` (add two models + back-relations on `Matter`, `CalendarEvent`, `User`)
- Create: `prisma/migrations/20261020120000_portal_case_status/migration.sql`
- Modify: `src/lib/permissions.ts` (portal group)
- Modify: `src/test/integration-helpers.ts` (`TABLES_IN_DELETE_ORDER`: add `"portal_shared_events"`, `"portal_status_updates"` in the Client portal block, before `portal_login_tokens`)
- Test: `src/lib/permissions.test.ts` (or the existing permissions test file)

**Interfaces:**
- Produces: Prisma models `PortalStatusUpdate { id, matterId, stageLabel, body, postedById, postedAt, editedAt?, emailedAt? }` mapped `portal_status_updates`, index `(matterId, postedAt)`; `PortalSharedEvent { id, eventId @unique, matterId, clientTitle, clientNote?, sharedById, sharedAt, updatedAt }` mapped `portal_shared_events`, index `(matterId)`. FKs to Matter and CalendarEvent are `onDelete: Cascade`; to User `onDelete: Restrict`.

- [ ] **Step 1:** Write a failing test asserting the four keys exist in the permission catalog under the portal group.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Add the four keys with labels/descriptions (e.g. "Post client status updates": "Post a dated status update clients see on the portal matter page; optionally emails them.", "Share events with clients": "Show a calendar event to the matter's clients with a client-facing title; time and location come from the event.").
- [ ] **Step 4:** Add the models. Generate the migration with `npx prisma migrate dev --create-only --name portal_case_status` against the local container only, then append the grant:
  ```sql
  INSERT INTO "role_permissions" ("roleId", "permission")
  SELECT DISTINCT "roleId", k FROM "role_permissions",
    unnest(ARRAY['portal.add_updates','portal.edit_updates','portal.delete_updates','portal.share_events']) AS k
  WHERE "permission" = 'matters.edit'
  ON CONFLICT ("roleId", "permission") DO NOTHING;
  ```
  Rename the folder to `20261020120000_portal_case_status` if Prisma chose another timestamp, as long as it sorts after the latest existing migration.
- [ ] **Step 5:** Run `npm run check:migrations` (expect no drift) and the permissions test (expect PASS).
- [ ] **Step 6:** Commit `feat(portal): case status schema and permission keys`.

### Task 2: Client reader

**Files:**
- Create: `src/lib/portal/status.ts` (`import "server-only"`)
- Test: `src/lib/portal/status.integration.test.ts`

**Interfaces:**
- Consumes: `portalMatterWhere(identityId)` from `@/lib/portal-access`.
- Produces:
  ```ts
  export type PortalStatusUpdateView = { id: string; stageLabel: string; body: string; postedAt: Date; edited: boolean };
  export type PortalSharedEventView = { id: string; title: string; note: string | null; startTime: Date; endTime: Date; isAllDay: boolean; location: string | null };
  export type PortalMatterStatus = { updates: PortalStatusUpdateView[]; upcoming: PortalSharedEventView[]; past: PortalSharedEventView[] };
  export async function getPortalMatterStatus(identityId: string, matterId: string): Promise<PortalMatterStatus>;
  export async function latestStageLabels(identityId: string, matterIds: string[]): Promise<Map<string, string>>;
  ```
  `updates` newest first. `upcoming` ascending by `startTime`; `past` descending. An event is upcoming when its end falls on today or later in `America/Denver` (for all-day events compare the calendar date). Empty result (not a throw) without live access, like `listPortalRequests`. `title` is the share's `clientTitle`.

- [ ] **Step 1:** Write failing integration tests (seed with `seedFirm({ portalEnabled: true })`-style helpers, `seedMatter`, `seedContact`, `seedCalendarEvent`, plus a portal identity + access row):
  - `returns updates newest first with edited flag`
  - `returns nothing when access revoked / portal off / identity disabled` (three cases, each `toEqual({ updates: [], upcoming: [], past: [] })`)
  - `hides a shared event re-filed to another matter on both matters`
  - `never exposes the internal event title or description` (assert `JSON.stringify(result)` does not contain the seeded internal title or description strings)
  - `all-day event today in Denver is upcoming` (fake timers at 23:30 Denver)
  - `latestStageLabels returns only matters with live access`
  - `archived matter stays readable`
- [ ] **Step 2:** Run them; expect FAIL (module missing).
- [ ] **Step 3:** Implement. Check the matter via `prisma.matter.findFirst({ where: { id: matterId, ...portalMatterWhere(identityId) } })` first; filter shares with `event: { matterId }` in the where clause; select only the fields in the view types.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(portal): case status reader`.

### Task 3: Status update actions and email

**Files:**
- Create: `src/app/actions/portal-status.ts` (`"use server"`)
- Modify: `src/lib/portal/emails.ts` (add `statusUpdateEmail`)
- Test: `src/app/actions/portal-status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Result = { ok: true; warning?: string } | { ok: false; error: string };
  export async function postStatusUpdate(matterId: string, input: { stageLabel: string; body: string; emailClient: boolean }): Promise<Result>;
  export async function editStatusUpdate(id: string, input: { stageLabel: string; body: string }): Promise<Result>;
  export async function deleteStatusUpdate(id: string): Promise<Result>;
  export function statusUpdateEmail(link: string): Body; // subject "Your legal team posted an update"; names no matter, no update text
  ```
  Gates: `requirePermissionResult("portal.add_updates" | "portal.edit_updates" | "portal.delete_updates")`, then `assertMatterAccess` (load the row's `matterId` first for edit/delete). Email only when `emailClient` and `emailLivePortalUsers` reports `sent > 0`; then set `emailedAt`. Failed sends → `ok: true, warning: "Update posted, but the email didn't send."`. Activity titles: `Posted client status update: <stageLabel>`, `Edited client status update`, `Deleted client status update`. Revalidate `/matters/${matterId}`.

- [ ] **Step 1:** Write failing tests:
  - denied without each key (returns `PERMISSION_DENIED_MESSAGE`, no row)
  - walled matter → `notFound` thrown, no row
  - validation: empty stage label, 61-char label, 4,001-char body → `ok: false`
  - `emails live portal users and sets emailedAt` (mock `sendEmail` from `@/lib/email/send` the way `portal-documents.test.ts` does)
  - `skips email when unticked` and `skips email when portal is off` (row saved, `emailedAt` null)
  - `edit sets editedAt and never re-sends` (send mock call count unchanged, `emailedAt` unchanged)
  - activity row written for each action
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with a Zod schema for the input (trim, limits from Global Constraints).
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(portal): post, edit and delete client status updates`.

### Task 4: Event sharing actions

**Files:**
- Modify: `src/app/actions/portal-status.ts`
- Test: `src/app/actions/portal-status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function shareEventWithClient(eventId: string, input: { clientTitle: string; clientNote?: string }): Promise<Result>;
  export async function updateEventShare(eventId: string, input: { clientTitle: string; clientNote?: string }): Promise<Result>;
  export async function stopSharingEvent(eventId: string): Promise<Result>;
  ```
  All gate on `portal.share_events`, load the event's `matterId`; null `matterId` → `{ ok: false, error: "Only events on a matter can be shared." }`; then `assertMatterAccess(event.matterId)`. Share upserts on `eventId` and resets `matterId` to the event's current matter (re-sharing after a re-file moves it). Update and stop act only on a share whose `matterId` equals the event's current matter, otherwise `{ ok: false, error: "This event isn't shared." }`. No email. Activity: `Shared event with client: <clientTitle>`, `Edited client event share`, `Stopped sharing event with client`. Revalidate `/matters/${matterId}`, `/matters/${matterId}/events`, `/calendar`.

- [ ] **Step 1:** Write failing tests: denied without key; lead event refused, nothing written; walled matter → `notFound`; share then re-file event then `updateEventShare` → "isn't shared"; re-share after re-file moves `matterId`; validation limits; stop deletes the row; activity rows.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(portal): share calendar events with clients`.

### Task 5: Staff "Client status" block

**Files:**
- Create: `src/lib/queries/portal-status.ts` (`getClientStatusCardData(matterId)`)
- Create: `src/components/matters/client-status-card.tsx` (+ dialog in the same file or `client-status-dialog.tsx`)
- Modify: `src/app/(dashboard)/matters/[id]/page.tsx` (load and render beside `PortalCard`/`ClientRequestsCard`, resolve the three update flags with `currentUserHasPermission`)
- Test: `src/lib/queries/portal-status.test.ts`, `src/components/matters/client-status-card.test.tsx`

**Interfaces:**
- Produces: `getClientStatusCardData(matterId: string): Promise<{ updates: { id; stageLabel; body; postedAt; editedAt; emailedAt; postedByName }[]; hasLiveAccess: boolean } | null>`: `assertMatterAccess` first, null without `portal.view` (same order as `getPortalCardData`). Card props: `{ matterId; data; canAdd; canEdit; canDelete }`.

- [ ] **Step 1:** Write failing tests: query returns null without `portal.view`, throws not-found on walled matter; card renders latest update + "N earlier" toggle, hides Post update without `canAdd`, prefills the stage label from the latest update, shows "No one has portal access on this matter yet." when `!hasLiveAccess`, the email checkbox is checked by default, and a `warning` result is shown as a toast/inline notice.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement, matching `client-requests-card.tsx` structure and UI_PATTERNS (DashboardCard-style frame, dialog patterns).
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(portal): client status card on matter overview`.

### Task 6: Share control in the event modal

**Files:**
- Modify: `src/components/calendar/event-detail-modal.tsx` (new optional prop `portalShare`)
- Create: `src/components/calendar/event-share-section.tsx`
- Modify: `src/app/(dashboard)/calendar/page.tsx`, `src/app/(dashboard)/matters/[id]/events/page.tsx` (load the share for the open event, resolve `portal.share_events`)
- Modify: `src/lib/queries/portal-status.ts` (`getEventShare(eventId)`)
- Test: `src/components/calendar/event-share-section.test.tsx`, `src/lib/queries/portal-status.test.ts`

**Interfaces:**
- Produces: `getEventShare(eventId: string): Promise<{ clientTitle: string; clientNote: string | null } | null>` returning null unless the share's `matterId` equals the event's current `matterId` (caller already asserted access). Modal prop `portalShare?: { canShare: boolean; share: { clientTitle: string; clientNote: string | null } | null }`; omitted for lead events and when the viewer lacks `portal.view`.

- [ ] **Step 1:** Write failing tests: section shows a "Share with client…" button that opens a dialog prefilled with the event title; shared state shows a "Shared" badge with Edit share / Stop sharing; no controls when `canShare` is false (badge still shows); `getEventShare` returns null after a re-file.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(portal): share events from the event modal`.

### Task 7: Portal pages

**Files:**
- Create: `src/app/(portal)/portal/matters/[id]/status-section.tsx`, `src/app/(portal)/portal/matters/[id]/events-section.tsx`
- Modify: `src/app/(portal)/portal/matters/[id]/page.tsx` (load `getPortalMatterStatus` in the existing `Promise.all`; render status then events above `RequestsSection`)
- Modify: `src/app/(portal)/portal/page.tsx` (use `latestStageLabels`; show the label beside `MatterStatus`)
- Test: `status-section.test.tsx`, `events-section.test.tsx` beside them; extend `src/app/(portal)/portal/page.test.tsx`

**Interfaces:**
- Consumes: Task 2 types.
- Copy (exact): heading "Where things stand"; "Updated {date}"; "Earlier updates"; empty "Your legal team hasn't posted an update yet."; heading "Coming up"; collapsed "Past". Events section renders nothing when both lists are empty.

- [ ] **Step 1:** Write failing render tests for both sections (data, empty states, line breaks preserved, text not interpreted as HTML: a body of `<b>x</b>` renders literally) and for the home stage label.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement following UI_PATTERNS § Client portal and the existing section components' styling. Dates formatted in `America/Denver`.
- [ ] **Step 4:** Run; expect PASS. Then `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 5:** Commit `feat(portal): case status on the client portal`.

### Task 8: Docs and cleanup

**Files:**
- Modify: `docs/features/client-portal.md` (table row 1 → Shipped; "End state (case status)" section: data, gate, staff UI, client UI, email, open risks), `docs/ROADMAP.md` client portal line ("status shipped; messages, invoices next")
- Delete: `docs/superpowers/specs/2026-10-20-portal-case-status-design.md`, this plan

- [ ] **Step 1:** Write the docs (end state, not history; keep the feature file under ~15KB by trimming if needed).
- [ ] **Step 2:** Commit `docs(portal): case status shipped; drop spec and plan` with the deletions in the pathspec.
