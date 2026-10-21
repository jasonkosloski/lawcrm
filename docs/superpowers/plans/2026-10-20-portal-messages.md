# Portal Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared, permanent message thread per matter between live portal clients and the matter team, with per-reader unread, staff notifications, and throttled client email.

**Architecture:** Three tables (`PortalThread`, `PortalMessage`, `PortalReadState`). One server-only write core (`recordPortalMessage`) used by both the client and staff send actions so thread fields and read cursors are maintained in one place. Client reads in `src/lib/portal/messages.ts`; staff reads in `src/lib/queries/portal-messages.ts`; client actions in `src/app/actions/portal-messages-client.ts`, staff actions in `src/app/actions/portal-messages.ts`.

**Tech Stack:** Next.js App Router (check `node_modules/next/dist/docs/`), Prisma 7 / Postgres, Zod, Vitest + happy-dom, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-20-portal-messages-design.md`

## Global Constraints

- Message `body`: trimmed, 1..5,000 chars, plain text, rendered as text with `whitespace-pre-line`, never HTML.
- Client rate limit: max 30 client messages per identity per matter per rolling hour; over → `{ ok: false, error: "You're sending messages too quickly. Try again later." }`.
- Client email throttle: at most one `portalMessageEmail` per identity per matter per 15 minutes (`PortalReadState.lastEmailedAt`); never while the portal is off; email names no matter and contains no message text; links to `portalHomeUrl()`.
- Client gate: live `PortalMatterAccess` (`portalMatterWhere`) AND `Firm.portalEnabled` AND `PortalIdentity.disabledAt IS NULL`; sending also requires `Matter.isArchived = false`. Reuse the gate pattern in `src/lib/portal/status.ts` (`liveMatterWhere`) — extract/export it rather than copying.
- Permission keys exactly: `portal.view_messages`, `portal.send_messages`; every staff read/write also requires matter access (`assertMatterAccess` inline in each action, outside try/catch; a static test enforces it).
- Messages are permanent: no update/delete action, ever.
- Portal time zone: import `PORTAL_TIME_ZONE` from `src/lib/portal/time-zone.ts`.
- Notification type `portal_message`; once per burst: skip a recipient who already has an unread `portal_message` notification for that matter.
- Migration folder `20261021140000_portal_messages` (sorts after `20261021130000_portal_case_status`); expand-only (ADR-058). Never run Prisma against a non-local DB.
- Exact copy: closed matter "This matter is closed. Contact the firm at {phone} or {email}." (omit a missing part gracefully); client empty state "No messages yet. Ask your legal team a question here."; client email subject "You have a new message from your legal team"; staff notification title "{client name} sent a message"; list chip "Awaiting reply"; staff hint "No one has portal access on this matter yet."
- Commit with explicit pathspec; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Two staff users: A opens the thread, B still sees it unread; B's count is unaffected by A's reply except the reply itself never counts as unread for anyone on staff. Test in Task 5.
2. Client sends while a staff reply is being written at the same instant → both stored; `lastMessageAt` is the later one and `lastFromClient` matches the later message. Test in Task 2.
3. Client's access revoked mid-conversation → their reader and send both refuse; staff still see their past messages labelled with their name. Test in Task 3 and Task 5.
4. Staff sends three replies within 15 minutes → exactly one client email; a fourth after 15 minutes → a second email. Test in Task 4.
5. A staff user without access to the matter (walled) never sees the thread in the Client portal list or gets a notification. Test in Task 3 (notification) and Task 5 (list).

---

### Task 1: Schema, migration, keys, notification type

**Files:**
- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/20261021140000_portal_messages/migration.sql`
- Modify: `src/lib/permissions.ts` (portal group), `src/lib/notification-type-meta.ts` (`portal_message`, icon e.g. `MessageSquare`), `src/test/integration-helpers.ts` (`TABLES_IN_DELETE_ORDER`: `portal_read_states`, `portal_messages`, `portal_threads` before `portal_login_tokens`)
- Test: `src/lib/permissions.test.ts`, `src/lib/notification-type-meta.test.ts`

**Interfaces:**
- Produces models per the spec "Data" section: `PortalThread { id, matterId @unique, lastMessageAt, lastFromClient, createdAt }`; `PortalMessage { id, threadId, body, authorKind, authorIdentityId?, authorUserId?, createdAt }` with index `(threadId, createdAt)`; `PortalReadState { id, threadId, userId?, identityId?, lastReadAt, lastEmailedAt?, updatedAt }` with uniques `(threadId, userId)` and `(threadId, identityId)`. FKs per spec (Cascade from thread/matter; Restrict for message authors; Cascade for read-state user/identity).

- [ ] **Step 1:** Failing tests: both keys in the catalog under portal; `portal_message` has meta.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Add keys (labels: "View client portal messages", "Send client portal messages"), meta, models; generate migration `--create-only` against a local scratch DB; append the grant (same SQL shape as `20261021130000_portal_case_status`, keys `portal.view_messages`, `portal.send_messages`, from roles holding `matters.edit`).
- [ ] **Step 4:** `npx prisma generate`, `npm run check:migrations` (no drift), tests PASS.
- [ ] **Step 5:** Commit `feat(portal): messages schema, keys and notification type`.

### Task 2: Write core and shared gate

**Files:**
- Create: `src/lib/portal/message-store.ts` (`import "server-only"`)
- Modify: `src/lib/portal/status.ts` (export the live-access gate as `livePortalMatterWhere(identityId)` and use it; behaviour unchanged)
- Test: `src/lib/portal/message-store.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PORTAL_MESSAGE_MAX = 5000;
  export function parseMessageBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string };
  export type PortalMessageAuthor = { kind: "client"; identityId: string } | { kind: "staff"; userId: string };
  export async function recordPortalMessage(matterId: string, body: string, author: PortalMessageAuthor): Promise<{ messageId: string; threadId: string; createdAt: Date }>;
  export async function advanceReadState(threadId: string, reader: { userId: string } | { identityId: string }, at?: Date): Promise<void>;
  ```
  `recordPortalMessage` in one transaction: upsert thread on `matterId` (new thread takes this message's time/kind), create message, `updateMany` thread `where { id, lastMessageAt: { lte: createdAt } }` setting `lastMessageAt` and `lastFromClient = kind === "client"`, then `advanceReadState` for the sender. Callers have already gated access. `livePortalMatterWhere` exported from `src/lib/portal/status.ts` returns a `Prisma.MatterWhereInput` or null when portal off / identity disabled.

- [ ] **Step 1:** Failing tests: `parseMessageBody` (empty/whitespace → error, 5,000 ok, 5,001 error, trims); first message creates the thread; a later client message sets `lastFromClient` true and staff message false; a client message at T2 followed by a staff message recorded with `now` = T1 < T2 leaves `lastMessageAt` = T2 and `lastFromClient` true (no regress); two concurrent sends via `Promise.all` both persist; sender read state advanced; status.ts tests still pass.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement. For the no-regress test, allow an optional `now?: Date` param on `recordPortalMessage` (default `new Date()`), used only by tests.
- [ ] **Step 4:** PASS (plus `src/lib/portal/status.integration.test.ts`).
- [ ] **Step 5:** Commit `feat(portal): message write core`.

### Task 3: Client reader and client actions

**Files:**
- Create: `src/lib/portal/messages.ts` (server-only), `src/app/actions/portal-messages-client.ts` (`"use server"`)
- Uses: `createNotifications` from `@/lib/notifications`, `logPortalEvent` from `@/lib/portal/audit`
- Test: `src/lib/portal/messages.integration.test.ts`, `src/app/actions/portal-messages-client.test.ts`

**Interfaces:**
- Consumes: Task 2 (`recordPortalMessage`, `advanceReadState`, `parseMessageBody`, `livePortalMatterWhere`).
- Produces:
  ```ts
  export type PortalMessageView = { id: string; body: string; createdAt: Date; fromClient: boolean; authorLabel: string };
  export async function getPortalMessages(identityId: string, matterId: string): Promise<PortalMessageView[]>; // oldest first; [] without gate
  export async function unreadPortalMessageMatters(identityId: string, matterIds: string[]): Promise<Set<string>>;
  // actions
  export async function sendPortalMessage(matterId: string, body: string): Promise<{ ok: true } | { ok: false; error: string }>;
  export async function markPortalMessagesRead(matterId: string): Promise<void>;
  ```
  `authorLabel`: "You" (viewer's own), co-client's `contact.name`, or "{staff name} (your legal team)". `sendPortalMessage`: `getPortalIdentity()` (null off the portal host → `{ ok: false, error: "Not signed in." }`), gate + not archived (else `{ ok: false, error: "You can't send messages on this matter." }`), body, rate limit (count client messages by this identity on this matter's thread with `createdAt > now - 1h`; ≥30 refuses), `recordPortalMessage`, staff notification (active team members, `removedAt: null`, who hold `portal.view_messages` and pass `canAccessMatter`; once-per-burst rule), `logPortalEvent({ identityId, matterId, title: "Sent a portal message" })`. Notification failures never fail the send.

- [ ] **Step 1:** Failing tests: reader returns [] for revoked / portal off / disabled; never another matter's messages; labels for self/co-client/staff; revoked co-client's messages still labelled with their name for a remaining client. Action: off-host null identity refused; closed matter refused; validation; 30th message ok and 31st refused within the hour; notification goes only to keyed team members with access (walled member and member without the key get none); second message while the first notification is unread creates no new notification; activity row written; read state advanced; `markPortalMessagesRead` no-op without gate.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement (permission check for recipients: reuse the permission resolver used by `currentUserHasPermission` for an arbitrary user id — find the helper in `src/lib/permission-check.ts`; if none takes a user id, add a small exported `userHasPermission(userId, key)` there with a test).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(portal): client messaging actions and reader`.

### Task 4: Staff send action and client email

**Files:**
- Create: `src/app/actions/portal-messages.ts` (`"use server"`)
- Modify: `src/lib/portal/emails.ts` (`portalMessageEmail(link)`)
- Test: `src/app/actions/portal-messages.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function sendStaffPortalMessage(matterId: string, body: string): Promise<{ ok: true; warning?: string } | { ok: false; error: string }>;
  export async function markStaffPortalThreadRead(matterId: string): Promise<void>;
  export function portalMessageEmail(link: string): Body; // subject "You have a new message from your legal team"
  ```
  Send: `requirePermissionResult("portal.send_messages")` → `assertMatterAccess(matterId)` inline → body → `recordPortalMessage` (staff author) → for each live portal identity of the matter (gate: access not revoked, identity enabled, portal on) whose read state `lastEmailedAt` is null or ≤ now − 15 min: `sendEmail` with `portalMessageEmail(portalHomeUrl())`, then set `lastEmailedAt` (upsert the identity's read state without moving `lastReadAt` forward; a new row gets `lastReadAt` = epoch 0) → failures give `warning: "Message sent, but the client email didn't go out."` → `logActivity({ matterId, userId, type: "note", title: "Sent a client portal message" })` → `revalidatePath(`/matters/${matterId}/communication`)` and `/communication`. Mark read: `portal.view_messages` (permission result; silent no-op on denial) + `assertMatterAccess` + `advanceReadState`.

- [ ] **Step 1:** Failing tests: denied without key; walled → not-found, nothing written; validation; email to live clients only (revoked/disabled excluded), none with portal off; three sends within 15 minutes → one email; send at +15m01s → second email (fake timers); email body contains neither matter name nor message text; delivery failure → saved + warning; activity row; sender read state advanced; `markStaffPortalThreadRead` advances only the caller's state.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement mirroring `src/app/actions/portal-status.ts`.
- [ ] **Step 4:** PASS, plus `src/app/actions/matter-access-guards.test.ts`.
- [ ] **Step 5:** Commit `feat(portal): staff messaging action and client email`.

### Task 5: Staff queries

**Files:**
- Create: `src/lib/queries/portal-messages.ts`
- Test: `src/lib/queries/portal-messages.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StaffPortalMessage = { id: string; body: string; createdAt: Date; fromClient: boolean; authorName: string };
  export async function getPortalConversation(matterId: string): Promise<{ messages: StaffPortalMessage[]; hasLiveAccess: boolean; unread: number } | null>;
  export type PortalThreadRow = { matterId: string; matterName: string; awaitingReply: boolean; unread: number; snippet: string; lastMessageAt: Date };
  export async function listPortalThreadsForViewer(page: number): Promise<{ rows: PortalThreadRow[]; total: number }>;
  ```
  Conversation: `assertMatterAccess` first, null without `portal.view_messages`, unread computed from the viewer's read state; `hasLiveAccess` via the existing `matterHasLivePortalAccess`. List: null-safe empty without `portal.view_messages`; threads whose matter passes `matterAccessWhere(viewer)`; order `lastFromClient desc, lastMessageAt desc`; 100 per page; snippet = last message body first 120 chars; unread per viewer (client messages after the viewer's `lastReadAt`).

- [ ] **Step 1:** Failing tests: null/empty without key; walled matter excluded from list and conversation throws not-found; ordering (awaiting first); A reads → A unread 0, B unread still N; staff messages never count as unread; snippet truncation at 120; revoked client's messages still present with their name; paging total.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement; compute unread with one grouped query, not N+1.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(portal): staff portal message queries`.

### Task 6: Staff UI — matter Portal channel

**Files:**
- Modify: `src/app/(dashboard)/matters/[id]/communication/page.tsx` (`?channel=portal`; extend the toggle), `src/components/communication/channel-toggle.tsx`
- Create: `src/components/communication/portal-conversation.tsx` (thread + composer + mark-read island)
- Test: `src/components/communication/portal-conversation.test.tsx`, extend `src/app/(dashboard)/matters/[id]/communication/page.test.tsx`

**Interfaces:**
- Consumes: Task 4 actions, Task 5 `getPortalConversation`.
- Props: `{ matterId: string; conversation: NonNullable<Awaited<ReturnType<typeof getPortalConversation>>>; canSend: boolean; tz: string }`.

- [ ] **Step 1:** Failing tests: Portal option hidden in the toggle without `portal.view_messages`; conversation renders client names and staff names, oldest first, body literal (`<b>x</b>`) with line breaks; composer hidden without `canSend`; send clears the draft on ok, keeps it on error, shows a warning notice; mark-read action called on mount; hint shown when `!hasLiveAccess`.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement following the Phone channel and `client-status-card.tsx` patterns; dates in the viewer's zone.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(portal): Portal channel on the matter Communication tab`.

### Task 7: Staff UI — Client portal list in /communication

**Files:**
- Modify: `src/app/(dashboard)/communication/page.tsx` (`?view=portal`), the view switcher component it uses
- Create: `src/components/communication/portal-thread-list.tsx`
- Test: `src/components/communication/portal-thread-list.test.tsx`, extend the communication page test

**Interfaces:**
- Consumes: Task 5 `listPortalThreadsForViewer`.

- [ ] **Step 1:** Failing tests: view option hidden without `portal.view_messages`; rows show matter name, "Awaiting reply" chip only when awaiting, unread count when > 0, snippet, relative time; row links to `/matters/:id/communication?channel=portal`; empty state; paging control like the other views.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement following the existing views' layout.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(portal): Client portal list in communication`.

### Task 8: Client UI

**Files:**
- Create: `src/app/(portal)/portal/matters/[id]/messages-section.tsx` (+ client composer component and mark-read island in the same folder)
- Modify: `src/app/(portal)/portal/matters/[id]/page.tsx` (load `getPortalMessages`; render under the events section), `src/app/(portal)/portal/page.tsx` ("New message" chip via `unreadPortalMessageMatters`)
- Test: `messages-section.test.tsx` beside it; extend `src/app/(portal)/portal/page.test.tsx`

**Interfaces:**
- Consumes: Task 3 reader + actions; firm phone/email as loaded in `src/app/(portal)/portal/layout.tsx` (load the same fields on the page).

- [ ] **Step 1:** Failing tests: conversation oldest first with labels; literal text and line breaks; empty-state copy; closed matter shows the closed copy with phone/email and no composer; send ok clears the draft, error keeps it and shows the message; rate-limit error shown; mark-read called on view; home chip shown only for unread matters.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement per UI_PATTERNS § Client portal; times in `PORTAL_TIME_ZONE`.
- [ ] **Step 4:** PASS; then `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 5:** Commit `feat(portal): messages on the client portal`.

### Task 9: Docs

**Files:**
- Modify: `docs/features/client-portal.md` (sub-project 3 → Shipped; "Messages (sub-project 3)" end-state section; open risks: no attachments, Denver zone, no read receipts); move the documents end-state into `docs/features/client-portal-documents.md` and link it, to bring client-portal.md under ~15KB; `docs/ROADMAP.md` client portal line ("foundation, documents, case status and messages shipped; invoices next").
- Delete (finishing commit, after the final review): this plan and the spec.

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Commit `docs(portal): messages shipped`.
