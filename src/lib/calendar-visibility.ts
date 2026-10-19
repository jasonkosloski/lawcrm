/**
 * Calendar event visibility resolver.
 *
 * Determines whether a viewer can see the full details of a
 * given calendar event, or only its time range as a "Busy"
 * placeholder.
 *
 * Privacy by default — every rule below is an OR with the
 * baseline of "no, you can't see this." That keeps personal
 * events truly personal until the creator opts in or a
 * relationship (attendee / matter team) makes the viewer a
 * legitimate stakeholder.
 *
 * One hard "no" comes first: an event whose per-event visibility is
 * `private` shows details to its CREATOR ONLY (ADR-037). It beats the
 * creator's show-details profile default, attendee status, matter
 * team membership and any permission; everyone else, invitees and
 * the matter team included, sees the time range as "Busy". Google
 * sync pushes such events as Google-private.
 *
 * Otherwise, five paths to "yes":
 *
 *   1. Viewer is the event's creator. You can always see your
 *      own events.
 *   2. Viewer is an attendee. If you're invited, you see
 *      what's on your invite.
 *   3. Event has a matter and viewer is on that matter's team.
 *      Matter events are case-team-visible by definition.
 *   4. Per-event override: `event.visibility === "show_details"`.
 *      Set on create / edit when the creator wants this
 *      specific event surfaced (e.g. firm happy hour).
 *   5. Per-user default: the event's creator has
 *      `defaultEventVisibility === "show_details"` set on
 *      their profile. Flips every event they create to
 *      publicly-visible unless explicitly overridden lower.
 *
 * Otherwise: "Busy" — render time range only, strip title /
 * location / description / attendees / matter name. The
 * stripped data never leaves the server, so this is a real
 * privacy boundary, not a client hint.
 *
 * Edit gating is a separate question (see canEditEvent) but
 * shares the creator-bypass shape.
 */

export type VisibilityInput = {
  /** Current viewer's user id. */
  viewerId: string;
  /** Who created the event. Creator-bypass branch. */
  createdById: string | null;
  /** Per-event visibility override. */
  eventVisibility: string;
  /** The event's creator's user-default. Drives branch 5. */
  creatorDefaultEventVisibility: string | null;
  /** Matter scope, if any. Drives branch 3. */
  matterId: string | null;
  /** User ids of every attendee on the event (`CalendarAttendee.userId`).
   *  External (contact / arbitrary) attendees aren't in this
   *  list — they don't grant view-as-firm-user access anyway. */
  attendeeUserIds: readonly string[];
  /** Active matter team member user ids when the event has a
   *  matter. Empty array when no matter or no team. */
  matterTeamUserIds: readonly string[];
  /** Whether the viewer may see the event's matter at all (matter-team
   *  access / "ethical walls", ADR-039). Ignored when the event has no
   *  matter. Omitted = accessible: only surfaces that are ALREADY
   *  scoped to matters the viewer can see (a matter's own page) may
   *  omit it; every cross-matter surface (calendar, dashboard) must
   *  pass it. */
  matterAccessible?: boolean;
  /** Intake lead scope, if any. */
  leadId?: string | null;
  /** Whether the viewer may see the event's lead (restricted intake,
   *  ADR-049). Same contract as `matterAccessible`. */
  leadAccessible?: boolean;
};

/** Per-event visibility values stored on `CalendarEvent.visibility`. */
export const EVENT_VISIBILITIES = ["default", "show_details", "private"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

/** Event title as it may appear in the matter activity log. A private
 *  event's title must not reach the timeline, which every matter
 *  viewer reads, so it is replaced by a generic label. */
export function auditEventTitle(
  visibility: string | null | undefined,
  title: string
): string {
  return visibility === "private" ? "Private event" : title;
}

export function canViewEventDetails(input: VisibilityInput): boolean {
  // Private: creator only, nobody else (not attendees, not the team).
  if (input.eventVisibility === "private") {
    return !!input.createdById && input.createdById === input.viewerId;
  }
  // 1. Creator bypass. Deliberate choice: the creator still sees their
  // OWN event even if they've since lost access to its matter — it is
  // their entry, and hiding it from them would orphan it.
  if (input.createdById && input.createdById === input.viewerId) return true;
  // Matter wall: an event on a matter the viewer can't access is "Busy"
  // for them — it beats attendee status, the per-event override and the
  // creator's show-details default (an attendee invite must not punch
  // through the wall). Only the creator (above) is exempt.
  if (input.matterId && input.matterAccessible === false) return false;
  // Lead wall: same rule for an event on a restricted lead.
  if (input.leadId && input.leadAccessible === false) return false;
  // 2. Attendee.
  if (input.attendeeUserIds.includes(input.viewerId)) return true;
  // 3. Matter team.
  if (input.matterId && input.matterTeamUserIds.includes(input.viewerId)) {
    return true;
  }
  // 4. Per-event override.
  if (input.eventVisibility === "show_details") return true;
  // 5. Per-user default. Only applies when the event itself is
  // on `default` - explicit `show_details` already returned true
  // and `private` returned above, so the user-default can never
  // override an explicit per-event choice.
  if (
    input.eventVisibility === "default" &&
    input.creatorDefaultEventVisibility === "show_details"
  ) {
    return true;
  }
  return false;
}

// ── Edit gate ───────────────────────────────────────────────────────────
//
// Edit permission rules:
//
//   1. Creator can always edit their own event.
//   2. Matter event + viewer has `events.edit` → can edit.
//      Deliberately NOT scoped to matter-team membership:
//      matter events are firm business, and `events.edit` is
//      the firm-wide grant that lets scheduling staff manage
//      any case's calendar (see the permission's description
//      in lib/permissions.ts).
//   3. Non-matter event + viewer has `events.edit_non_matter`
//      → can edit.
//
// `events.edit` alone does NOT let a viewer edit another user's
// non-matter event. The new `events.edit_non_matter` permission
// gates that explicitly so admins can hand it out only when
// they actually want cross-user personal-event editing.
//
// Defense in depth: the resolver below is the source of truth
// for the modal's `canEdit` prop AND the action's gate. Action
// re-runs it server-side regardless of what the client sent.

export type EditPermissions = {
  /** True when the viewer holds `events.edit`. */
  hasEventsEdit: boolean;
  /** True when the viewer holds `events.edit_non_matter`. */
  hasEventsEditNonMatter: boolean;
};

export type EditInput = {
  viewerId: string;
  createdById: string | null;
  matterId: string | null;
  /** NOT consulted by the edit gate — matter edits are gated on
   *  `events.edit` alone (header rule 2). Kept in the shape so a
   *  future team-scoped tightening can use it without reworking
   *  the call sites in actions/calendar-events.ts, which already
   *  populate it. */
  matterTeamUserIds: readonly string[];
  perms: EditPermissions;
};

export function canEditEvent(input: EditInput): boolean {
  // Creator bypass.
  if (input.createdById && input.createdById === input.viewerId) return true;
  if (input.matterId) {
    // Matter event — events.edit alone is the gate. Team
    // membership is deliberately not required: matter events
    // are firm business, not personal ones (header rule 2).
    return input.perms.hasEventsEdit;
  }
  // Non-matter event — needs the dedicated permission so a
  // user with plain events.edit can't edit other users'
  // personal events.
  return input.perms.hasEventsEditNonMatter;
}

// ── Mutation gate: Busy viewers can't touch what they can't see ─────────
//
// `canEditEvent` answers "do your permission keys allow this edit?".
// It says nothing about whether the viewer may reach the event at all.
// Two hard walls sit on top of it, for every per-event mutation
// (update, move/resize, delete):
//
//   - PRIVATE events (ADR-037) are creator-only: a viewer who only
//     sees the "Busy" placeholder - an invitee, the matter team, even
//     an `events.edit` / Admin holder - can't move, resize, edit or
//     delete one. Without this, anyone with `events.edit` could
//     rearrange a colleague's private calendar blind.
//   - An event on a matter the viewer can't access (matter-team walls,
//     ADR-039) is Busy for them and untouchable: seeing is the
//     precondition for doing - including for its creator, who may
//     still SEE their own entry (canViewEventDetails) but can't act on
//     a matter they've lost.
//
// Deliberately NOT a blanket "Busy => no edit": a non-private,
// non-walled personal event that merely defaults to Busy stays editable
// by a holder of `events.edit_non_matter`, which is that key's whole
// purpose (cross-user personal-calendar admin).

/** The relations/columns `viewerMayTouchLoadedEvent` needs. */
export type LoadedEventForTouch = {
  createdById: string | null;
  visibility: string;
  matterId: string | null;
};

export function viewerMayTouchLoadedEvent(
  viewerId: string,
  e: LoadedEventForTouch,
  matterAccessible: boolean
): boolean {
  if (e.matterId && !matterAccessible) return false;
  if (e.visibility === "private") {
    return !!e.createdById && e.createdById === viewerId;
  }
  return true;
}
