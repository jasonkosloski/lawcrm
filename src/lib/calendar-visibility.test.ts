/**
 * Pure-function tests for the calendar visibility resolver.
 *
 * Two resolvers, two responsibilities:
 *
 *   - canViewEventDetails — privacy gate. Default-deny with five
 *     OR'd unlock paths (creator, attendee, matter team, per-event
 *     override, per-creator default). Each branch gets its own
 *     case + a couple of negative cases to confirm the surrounding
 *     branches don't leak.
 *
 *   - canEditEvent — authorization gate. Three branches: creator,
 *     matter event needs events.edit, non-matter event needs
 *     events.edit_non_matter. Same shape — each branch has a yes
 *     and a no case.
 *
 * No DB / no module mocks — both resolvers are pure data-in /
 * boolean-out.
 */

import { describe, expect, test } from "vitest";
import {
  canEditEvent,
  canViewEventDetails,
  type EditInput,
  type VisibilityInput,
} from "./calendar-visibility";

const baseView: VisibilityInput = {
  viewerId: "viewer-1",
  createdById: "creator-1",
  eventVisibility: "default",
  creatorDefaultEventVisibility: "default",
  matterId: null,
  attendeeUserIds: [],
  matterTeamUserIds: [],
};

describe("canViewEventDetails", () => {
  test("baseline: stranger viewing a default event sees nothing", () => {
    expect(canViewEventDetails(baseView)).toBe(false);
  });

  test("branch 1: creator can always see their own event", () => {
    expect(
      canViewEventDetails({ ...baseView, viewerId: "creator-1" })
    ).toBe(true);
  });

  test("branch 1: creator bypass is suppressed when createdById is null (legacy event)", () => {
    expect(
      canViewEventDetails({
        ...baseView,
        createdById: null,
        viewerId: "anyone",
      })
    ).toBe(false);
  });

  test("branch 2: viewer is on the attendee list", () => {
    expect(
      canViewEventDetails({
        ...baseView,
        attendeeUserIds: ["someone-else", "viewer-1", "another"],
      })
    ).toBe(true);
  });

  test("branch 2: similar-but-not-equal id does NOT match (no prefix matching)", () => {
    expect(
      canViewEventDetails({
        ...baseView,
        attendeeUserIds: ["viewer-1-extra"],
      })
    ).toBe(false);
  });

  test("branch 3: matter team member sees a matter event", () => {
    expect(
      canViewEventDetails({
        ...baseView,
        matterId: "matter-9",
        matterTeamUserIds: ["viewer-1"],
      })
    ).toBe(true);
  });

  test("branch 3: team membership without a matter does NOT unlock (defensive)", () => {
    // A non-matter event with a stale matterTeamUserIds list should
    // not leak — the matterId guard short-circuits the branch.
    expect(
      canViewEventDetails({
        ...baseView,
        matterId: null,
        matterTeamUserIds: ["viewer-1"],
      })
    ).toBe(false);
  });

  test("branch 3: team list is empty for a matter the viewer isn't on", () => {
    expect(
      canViewEventDetails({
        ...baseView,
        matterId: "matter-9",
        matterTeamUserIds: ["someone-else"],
      })
    ).toBe(false);
  });

  test("branch 4: per-event 'show_details' opens the event up to anyone", () => {
    expect(
      canViewEventDetails({ ...baseView, eventVisibility: "show_details" })
    ).toBe(true);
  });

  test("branch 5: creator's user-default 'show_details' opens default events", () => {
    expect(
      canViewEventDetails({
        ...baseView,
        eventVisibility: "default",
        creatorDefaultEventVisibility: "show_details",
      })
    ).toBe(true);
  });

  test("branch 5: user-default does not unlock when the event has its own value (only 'default' triggers it)", () => {
    // Per-event value of "default" is the only state that defers
    // to the creator's user-default. Once a future "private" value
    // exists this guard keeps the user-default from overriding it.
    expect(
      canViewEventDetails({
        ...baseView,
        eventVisibility: "private", // hypothetical future value
        creatorDefaultEventVisibility: "show_details",
      })
    ).toBe(false);
  });

  test("creator's user-default 'default' leaves the event closed", () => {
    expect(
      canViewEventDetails({
        ...baseView,
        creatorDefaultEventVisibility: "default",
      })
    ).toBe(false);
  });

  test("null creator-default is safe (no user-default leak)", () => {
    expect(
      canViewEventDetails({
        ...baseView,
        creatorDefaultEventVisibility: null,
      })
    ).toBe(false);
  });
});

const baseEdit: EditInput = {
  viewerId: "viewer-1",
  createdById: "creator-1",
  matterId: null,
  matterTeamUserIds: [],
  perms: { hasEventsEdit: false, hasEventsEditNonMatter: false },
};

describe("canEditEvent", () => {
  test("creator can always edit their own event (matter or not)", () => {
    expect(
      canEditEvent({ ...baseEdit, viewerId: "creator-1" })
    ).toBe(true);
    expect(
      canEditEvent({
        ...baseEdit,
        viewerId: "creator-1",
        matterId: "m1",
        matterTeamUserIds: [],
      })
    ).toBe(true);
  });

  test("matter event: events.edit allows editing even when the viewer is NOT on the matter team", () => {
    // Deliberate policy (header rule 2): matter events are firm
    // business, so events.edit is firm-wide and not scoped to
    // team membership.
    expect(
      canEditEvent({
        ...baseEdit,
        matterId: "m1",
        matterTeamUserIds: ["someone-else"],
        perms: { hasEventsEdit: true, hasEventsEditNonMatter: false },
      })
    ).toBe(true);
  });

  test("matter event: missing events.edit is rejected even with events.edit_non_matter", () => {
    // edit_non_matter is irrelevant to matter events — the matter
    // gate is the real check.
    expect(
      canEditEvent({
        ...baseEdit,
        matterId: "m1",
        perms: { hasEventsEdit: false, hasEventsEditNonMatter: true },
      })
    ).toBe(false);
  });

  test("non-matter event: events.edit_non_matter allows editing", () => {
    expect(
      canEditEvent({
        ...baseEdit,
        perms: { hasEventsEdit: false, hasEventsEditNonMatter: true },
      })
    ).toBe(true);
  });

  test("non-matter event: events.edit alone is NOT enough", () => {
    // The whole point of splitting the permission: events.edit
    // does not let an admin edit other users' personal events.
    expect(
      canEditEvent({
        ...baseEdit,
        perms: { hasEventsEdit: true, hasEventsEditNonMatter: false },
      })
    ).toBe(false);
  });

  test("non-creator with no permissions is rejected", () => {
    expect(canEditEvent(baseEdit)).toBe(false);
  });

  test("createdById null + non-creator viewer + no perms → no edit", () => {
    // Legacy event with no creator stamped: only the permission
    // gates can grant edit access.
    expect(
      canEditEvent({ ...baseEdit, createdById: null })
    ).toBe(false);
    expect(
      canEditEvent({
        ...baseEdit,
        createdById: null,
        perms: { hasEventsEdit: false, hasEventsEditNonMatter: true },
      })
    ).toBe(true);
  });
});
