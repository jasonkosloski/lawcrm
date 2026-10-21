# Client portal: messages (sub-project 3) design

Tier: Full (schema, client/staff visibility, new permission keys).

## Goal
A client asks a question in the portal instead of phoning; the right staff see it promptly and reply; the client is nudged by email without the message leaving the portal.

Decided with the user (2026-10-20):
- One shared thread per matter: every live portal client on the matter and the matter team see the same conversation.
- Staff read and reply on the matter Communication tab ("Portal" channel) and see a firm-wide "Client portal" list in `/communication`.
- Client message → in-app notification to the active matter team.
- Unread is per staff user (and per client identity).
- Staff reply → client is always emailed, throttled to one email per client per matter per 15 minutes.
- Messages are permanent: no edit or delete for anyone.
- Closed (archived) matters are read-only for clients; staff can still post.
- Out of scope: attachments (clients use document upload), read receipts, typing indicators, a "Needs me now" group (possible follow-up).

## Data (approach A: thread row per matter)
`PortalThread` (`portal_threads`)
- `id`, `matterId` (FK Matter, unique, onDelete Cascade), `lastMessageAt`, `lastFromClient` (Boolean: newest message is a client's, i.e. awaiting a firm reply), `createdAt`.
- Created on the first message from either side (upsert on `matterId`).
- Denormalized fields advance with a guarded `updateMany` (`where lastMessageAt <= new createdAt`) so concurrent sends never regress them.

`PortalMessage` (`portal_messages`)
- `id`, `threadId` (FK PortalThread, Cascade), `body` (String, trimmed, 1..5,000, plain text), `authorKind` (`client` | `staff`), `authorIdentityId?` (FK PortalIdentity, Restrict), `authorUserId?` (FK User, Restrict), `createdAt`.
- Exactly one author FK set, matching `authorKind` (app-enforced).
- Index `(threadId, createdAt)`.
- Permanent: no update or delete action exists.

`PortalReadState` (`portal_read_states`)
- `id`, `threadId` (FK PortalThread, Cascade), `userId?` (FK User, Cascade), `identityId?` (FK PortalIdentity, Cascade), `lastReadAt`, `lastEmailedAt?` (client rows only), `updatedAt`.
- Unique `(threadId, userId)` and `(threadId, identityId)`; exactly one of the two set.
- Staff unread = client messages with `createdAt > lastReadAt` (no row = all unread). Client unread = staff messages after the identity's `lastReadAt`.

Migration: create the three tables; grant `portal.view_messages`, `portal.send_messages` to every role holding `matters.edit` (same pattern as the case-status migration). Expand-only (ADR-058); its folder must sort after the latest existing migration.

## Permissions
- `portal.view_messages`: read a matter's portal conversation and the firm-wide Client portal list.
- `portal.send_messages`: post a message to clients.
Both also require matter access (`assertMatterAccess` / `matterAccessWhere`).

## Client side
Gate (same as case status): live `PortalMatterAccess`, portal on, identity not disabled (`portalMatterWhere` covers revocation only, so check the other two, as `src/lib/portal/status.ts` does). Sending also requires `Matter.isArchived = false`.

- Reader `getPortalMessages(identityId, matterId)` in `src/lib/portal/messages.ts`: empty without the gate; returns messages oldest first with `{ id, body, createdAt, fromClient, authorLabel }` where `authorLabel` is "You" for the viewer's own messages, the co-client's contact name for other clients, and "<staff name> (your legal team)" for staff. Selects only those fields.
- Action `sendPortalMessage(matterId, body)` (portal host only; identity from `requirePortalIdentity`): re-checks gate and open matter, validates body, enforces the rate limit (max 30 client messages per identity per matter per rolling hour → `{ ok: false, error: "You're sending messages too quickly. Try again later." }`), writes the message, upserts the thread and advances its fields, advances the sender's read state, notifies staff, and records `logPortalEvent`.
- Action `markPortalMessagesRead(matterId)`: advances the identity's read state (gate-checked; no-op without access).
- UI: a **Messages** section on the portal matter page under "Coming up": conversation oldest→newest, author label, time (America/Denver via `src/lib/portal/time-zone.ts`), textarea composer with a **Send** button (Enter inserts a newline). Closed matter: composer replaced by "This matter is closed. Contact the firm at {phone} or {email}." using the firm fields the portal footer uses. Empty state: "No messages yet. Ask your legal team a question here." An invisible island marks read on view.
- Portal home: a "New message" chip on a matter row when it has unread staff messages for the identity (`unreadPortalMessageMatters(identityId, matterIds)`).

## Staff side
- Query `getPortalConversation(matterId)` in `src/lib/queries/portal-messages.ts`: `assertMatterAccess` first, null without `portal.view_messages`; returns messages (oldest first, author name, fromClient), `hasLiveAccess`, and the viewer's unread count.
- Action `sendStaffPortalMessage(matterId, body)` in `src/app/actions/portal-messages.ts`: `requirePermissionResult("portal.send_messages")` → `assertMatterAccess` (inline, outside try/catch) → validate → write + thread fields + advance own read state → email clients (throttled) → `logActivity` (type matching portal conventions) → `revalidatePath` for the matter Communication tab and `/communication`.
- Action `markStaffPortalThreadRead(matterId)`: session + matter access + `portal.view_messages`; upserts the viewer's read state to now.
- **Matter → Communication → Portal channel** (`?channel=portal`, beside Email | Phone; hidden without `portal.view_messages`): conversation with client names, composer with `portal.send_messages`, mark-read island, the "No one has portal access on this matter yet." hint when no live access (posting still allowed).
- **`/communication` → "Client portal" view** (`portal.view_messages`): matters the viewer can access that have a thread; each row shows matter name, an **Awaiting reply** chip when `lastFromClient`, the viewer's unread count, a snippet of the last message (first 120 chars), and relative time. Order: awaiting reply first, then `lastMessageAt` desc. Paged like the other views (100 per page). Row → `/matters/:id/communication?channel=portal`.

## Notifications and email
- Client message → `createNotifications` type `portal_message` ("<client name> sent a message", body = matter name, link to the Portal channel) to active matter team members who hold `portal.view_messages` and can access the matter. Once per burst: skip a user who already has an unread `portal_message` notification for that matter. Register the type in `src/lib/notification-type-meta.ts`.
- Staff message → `portalMessageEmail` ("You have a new message from your legal team", portal link, no text, names no matter) to each live portal client of the matter whose read state has `lastEmailedAt` null or more than 15 minutes ago; set `lastEmailedAt` on success. Nothing while the portal is off. A delivery failure returns `ok: true` with a warning; the message is already saved.

## Edge cases
- Revoked access / portal off: the client loses the thread immediately; history stays for staff.
- A co-client whose access was revoked: their messages stay, labelled with their name.
- Concurrent sends: both stored; thread fields never regress.
- Rendering: text only with `whitespace-pre-line`; never HTML.
- Matter deleted: cascade removes thread, messages and read states.

## Testing
- Client action: gate (revoked, portal off, disabled identity, closed matter, called off the portal host), validation (empty, 5,001 chars), rate limit at 30/31, read state advanced, notification once per burst and only to keyed, accessible team members, `logPortalEvent` written.
- Client reader: never returns another matter's messages; author labels; nothing without the gate.
- Staff action: each key, walled matter → not-found and nothing written, email throttle at the 15-minute boundary, no email with the portal off, warning on delivery failure, activity row, read state advanced.
- Unread: per user (A reads, B still unread); client unread chip.
- Firm-wide list: only accessible matters, awaiting-reply ordering, unread counts per viewer.
- Render tests: portal Messages section (closed matter, empty, literal `<b>x</b>`), staff Portal channel, Client portal list.

## Docs on ship
`docs/features/client-portal.md` (sub-project 3 shipped, end state; consider splitting documents into its own file to get under ~15KB), ROADMAP line, PERMISSIONS only if conventions change. Delete this spec and its plan in the finishing commit.
