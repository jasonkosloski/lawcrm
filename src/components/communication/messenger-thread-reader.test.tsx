/**
 * Tests for MessengerThreadReader.
 *
 * Pins two rendering bugs so they can't regress:
 *   1. Zero-second voicemails must not leak a literal "0" into the
 *      header row (`{n && ...}` short-circuits to the number 0,
 *      which React renders as text).
 *   2. The log-time button on SMS bubbles / call events hides at
 *      rest ONLY on hover-capable devices. Tailwind v4 gates
 *      `group-hover:` behind `@media (hover: hover)`, so a bare
 *      `opacity-0` would leave the button permanently invisible on
 *      touch. We assert the hide rule carries the same media gate.
 *
 * Child client components (composer buttons, follow-up, etc) are
 * mocked out — they pull in server actions and are tested (or
 * exempt as layout) on their own.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessengerThreadReader } from "./messenger-thread-reader";
import { currentUserHasPermission } from "@/lib/permission-check";
import type {
  MessengerItemRow,
  MessengerThreadDetail,
} from "@/lib/queries/messenger";

vi.mock("@/app/actions/follow-ups", () => ({
  setMessengerThreadFollowUp: vi.fn(),
}));
vi.mock("./back-to-list-button", () => ({
  BackToListButton: () => null,
}));
vi.mock("./follow-up-button", () => ({
  FollowUpButton: () => null,
}));
vi.mock("./inbox-action-buttons", () => ({
  // Marker exposing the permission flags the reader threads down.
  InboxActionButtons: ({
    canCreateNote,
    canCreateTask,
    canCreateDeadline,
  }: {
    canCreateNote: boolean;
    canCreateTask: boolean;
    canCreateDeadline: boolean;
  }) => (
    <span
      data-testid="inbox-actions"
      data-note={String(canCreateNote)}
      data-task={String(canCreateTask)}
      data-deadline={String(canCreateDeadline)}
    />
  ),
}));
// The reader resolves the action-affordance flags itself (async
// server component); the real resolver needs a session + prisma.
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("./comm-time-logged-indicator", () => ({
  CommTimeLoggedIndicator: () => null,
}));
vi.mock("./log-time-on-comm-button", () => ({
  // Marker element so tests can locate the wrapper div whose
  // opacity classes control hover-reveal visibility.
  LogTimeOnCommButton: () => <span data-testid="log-time-btn" />,
}));
vi.mock("./manual-call-actions", () => ({
  // Marker exposing the gating props — the real component pulls in
  // the deleteCallLog server action (prisma), not loadable here.
  ManualCallActions: ({
    canEdit,
    canDelete,
  }: {
    canEdit: boolean;
    canDelete: boolean;
  }) => (
    <span
      data-testid="manual-call-actions"
      data-can-edit={String(canEdit)}
      data-can-delete={String(canDelete)}
    />
  ),
}));
vi.mock("./mark-thread-read", () => ({
  // Marker exposing the props so the mount test below can assert the
  // reader wires the right channel + thread id. The real island
  // imports server actions (prisma) — not loadable in happy-dom.
  MarkThreadRead: ({
    threadId,
    channel,
  }: {
    threadId: string;
    channel: string;
  }) => (
    <span
      data-testid="mark-thread-read"
      data-thread-id={threadId}
      data-channel={channel}
    />
  ),
}));

function makeItem(overrides: Partial<MessengerItemRow>): MessengerItemRow {
  return {
    id: "item-1",
    kind: "sms",
    direction: "inbound",
    fromNumber: "+15555550100",
    toNumber: "+15555550199",
    body: "Hello",
    mediaUrls: [],
    callDurationSec: null,
    callStatus: null,
    recordingUrl: null,
    transcript: null,
    matterId: null,
    matterName: null,
    matterColor: null,
    isRead: true,
    // 2:05 PM — `h:mm a` never renders a leading zero, so header
    // text assertions below stay unambiguous about stray "0"s.
    occurredAt: new Date(2026, 6, 6, 14, 5, 0),
    isManual: false,
    timeEntries: [],
    ...overrides,
  } as MessengerItemRow;
}

function makeThread(items: MessengerItemRow[]): MessengerThreadDetail {
  return {
    id: "thread-1",
    contactPhone: "+15555550100",
    contact: {
      id: "contact-1",
      name: "Dana Client",
      type: "person",
      organization: null,
    },
    // null — avoids rendering next/link, which needs router context.
    defaultMatter: null,
    isPinned: false,
    isArchived: false,
    followUpAt: null,
    items,
  };
}

type ReaderProps = Parameters<typeof MessengerThreadReader>[0];

/** MessengerThreadReader is an async server component: await it,
 *  then render the element tree it returns. */
async function renderReader(props: ReaderProps) {
  return render(await MessengerThreadReader(props));
}

beforeEach(() => {
  vi.mocked(currentUserHasPermission).mockReset();
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
});

describe("VoicemailCard duration guard", () => {
  test("a 0-second voicemail renders no stray '0' in the header row", async () => {
    await renderReader({
      thread: makeThread([
        makeItem({ kind: "voicemail", body: null, callDurationSec: 0 }),
      ]),
    });
    const label = screen.getByText("Voicemail");
    // The buggy `{0 && ...}` rendered "Voicemail" + "0" + time.
    expect(label.parentElement?.textContent).toBe("Voicemail2:05 PM");
  });

  test("a positive duration still renders formatted", async () => {
    await renderReader({
      thread: makeThread([
        makeItem({ kind: "voicemail", body: null, callDurationSec: 62 }),
      ]),
    });
    expect(screen.getByText("1m 2s")).toBeInTheDocument();
  });
});

describe("mark-as-read island", () => {
  test("opening a thread mounts MarkThreadRead with the messenger channel + thread id", async () => {
    await renderReader({ thread: makeThread([makeItem({})]) });
    const island = screen.getByTestId("mark-thread-read");
    expect(island).toHaveAttribute("data-channel", "messenger");
    expect(island).toHaveAttribute("data-thread-id", "thread-1");
  });

  test("the empty state (no thread selected) mounts no island", async () => {
    await renderReader({ thread: null });
    expect(screen.queryByTestId("mark-thread-read")).toBeNull();
  });
});

describe("manual-call edit/delete kebab gating", () => {
  const manualCall = () =>
    makeItem({
      kind: "call",
      body: "Discussed schedule",
      callStatus: "answered",
      callDurationSec: 300,
      isManual: true,
    });

  test("manual call + permissions → kebab rendered with the flags", async () => {
    await renderReader({
      thread: makeThread([manualCall()]),
      canEditCall: true,
      canDeleteCall: false,
    });
    const kebab = screen.getByTestId("manual-call-actions");
    expect(kebab).toHaveAttribute("data-can-edit", "true");
    expect(kebab).toHaveAttribute("data-can-delete", "false");
  });

  test("provider-synced call never gets the kebab, even with permissions", async () => {
    await renderReader({
      thread: makeThread([
        makeItem({
          kind: "call",
          callStatus: "answered",
          callDurationSec: 300,
          isManual: false,
        }),
      ]),
      canEditCall: true,
      canDeleteCall: true,
    });
    expect(screen.queryByTestId("manual-call-actions")).toBeNull();
  });

  test("no permissions (default props) → no kebab on manual calls", async () => {
    await renderReader({ thread: makeThread([manualCall()]) });
    expect(screen.queryByTestId("manual-call-actions")).toBeNull();
  });
});

describe("log-time button hover-reveal (touch visibility)", () => {
  // A bare `opacity-0` (no hover:hover media gate) hides the button
  // forever on touch devices — Tailwind v4's group-hover only fires
  // inside `@media (hover: hover)`, so nothing would reveal it.
  const bareOpacityZero = /(?:^|\s)opacity-0(?:\s|$)/;

  test("SMS bubble hides the button at rest only behind hover:hover", async () => {
    await renderReader({ thread: makeThread([makeItem({})]) });
    const wrapper = screen.getByTestId("log-time-btn").parentElement!;
    expect(wrapper.className).toContain("[@media(hover:hover)]:opacity-0");
    expect(wrapper.className).toContain("group-hover/msg:opacity-100");
    expect(wrapper.className).not.toMatch(bareOpacityZero);
  });

  test("call event hides the button at rest only behind hover:hover", async () => {
    await renderReader({
      thread: makeThread([
        makeItem({
          kind: "call",
          body: null,
          callStatus: "completed",
          callDurationSec: 90,
        }),
      ]),
    });
    const wrapper = screen.getByTestId("log-time-btn").parentElement!;
    expect(wrapper.className).toContain("[@media(hover:hover)]:opacity-0");
    expect(wrapper.className).toContain("group-hover/call:opacity-100");
    expect(wrapper.className).not.toMatch(bareOpacityZero);
  });
});

describe("call labelling matches the shared isMissedCall predicate", () => {
  const call = (overrides: Partial<MessengerItemRow>) =>
    makeItem({
      kind: "call",
      body: null,
      callDurationSec: null,
      ...overrides,
    });

  test("outbound no-answer is the firm's own call, not 'Missed call'", async () => {
    await renderReader({
      thread: makeThread([
        call({ direction: "outbound", callStatus: "no_answer" }),
      ]),
    });
    expect(screen.queryByText(/Missed call/)).toBeNull();
    expect(screen.getByText("Outbound call, no answer")).toBeInTheDocument();
  });

  test("inbound declined IS a missed call (list parity)", async () => {
    await renderReader({
      thread: makeThread([
        call({ direction: "inbound", callStatus: "declined" }),
      ]),
    });
    expect(screen.getByText(/^Missed call/)).toBeInTheDocument();
  });

  test("inbound no-answer is a missed call", async () => {
    await renderReader({
      thread: makeThread([
        call({ direction: "inbound", callStatus: "no_answer" }),
      ]),
    });
    expect(screen.getByText(/^Missed call/)).toBeInTheDocument();
  });

  test("an answered call with unknown duration shows no '0s'", async () => {
    await renderReader({
      thread: makeThread([
        call({ direction: "outbound", callStatus: "answered" }),
      ]),
    });
    const label = screen.getByText(/^Outbound call/);
    expect(label.textContent).toBe("Outbound call");
  });

  test("a known duration renders in minutes", async () => {
    await renderReader({
      thread: makeThread([
        call({
          direction: "inbound",
          callStatus: "answered",
          callDurationSec: 300,
        }),
      ]),
    });
    expect(screen.getByText("Inbound call · 5m")).toBeInTheDocument();
  });
});

describe("day dividers + full timestamps", () => {
  test("a thread spanning two days gets a divider per day in the viewer's zone", async () => {
    await renderReader({
      thread: makeThread([
        // Jul 6, 8:00 PM MDT and Jul 7, 9:00 AM MDT - the first is
        // already Jul 7 in UTC, so a UTC-bucketed divider would merge.
        makeItem({ id: "a", occurredAt: new Date("2026-07-07T02:00:00Z") }),
        makeItem({ id: "b", occurredAt: new Date("2026-07-07T15:00:00Z") }),
        makeItem({ id: "c", occurredAt: new Date("2026-07-07T16:00:00Z") }),
      ]),
      tz: "America/Denver",
    });
    const dividers = screen.getAllByRole("separator");
    expect(dividers.map((d) => d.textContent)).toEqual([
      "Mon, Jul 6, 2026",
      "Tue, Jul 7, 2026",
    ]);
  });

  test("timestamps carry the full date and time as a tooltip", async () => {
    await renderReader({
      thread: makeThread([
        makeItem({ occurredAt: new Date("2026-07-07T02:05:00Z") }),
      ]),
      tz: "America/Denver",
    });
    const stamp = screen.getByText("8:05 PM");
    expect(stamp).toHaveAttribute(
      "title",
      expect.stringContaining("July 6, 2026"),
    );
  });
});

describe("action affordances honour the viewer's permissions", () => {
  const voicemail = () =>
    makeItem({ kind: "voicemail", body: null, transcript: "Call me back" });

  test("without time_entries.create the log-time buttons are not rendered", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key !== "time_entries.create",
    );
    await renderReader({
      thread: makeThread([makeItem({ id: "s" }), voicemail()]),
    });
    expect(screen.queryByTestId("log-time-btn")).toBeNull();
  });

  test("with the permission the log-time buttons render", async () => {
    await renderReader({ thread: makeThread([makeItem({})]) });
    expect(screen.getByTestId("log-time-btn")).toBeInTheDocument();
  });

  test("voicemail inbox actions receive per-key flags", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key === "notes.create",
    );
    await renderReader({ thread: makeThread([voicemail()]) });
    const actions = screen.getByTestId("inbox-actions");
    expect(actions).toHaveAttribute("data-note", "true");
    expect(actions).toHaveAttribute("data-task", "false");
    expect(actions).toHaveAttribute("data-deadline", "false");
  });

  test("the empty state does no permission lookups", async () => {
    await renderReader({ thread: null });
    expect(currentUserHasPermission).not.toHaveBeenCalled();
  });
});

describe("empty-state copy", () => {
  test("does not claim Quo auto-ingest that does not exist", async () => {
    await renderReader({ thread: null });
    expect(screen.queryByText(/land here automatically/i)).toBeNull();
    expect(screen.getByText(/once Quo is connected/i)).toBeInTheDocument();
  });
});

describe("hover-reveal controls are keyboard reachable", () => {
  test("the SMS log-time wrapper also reveals on focus-within", async () => {
    await renderReader({ thread: makeThread([makeItem({})]) });
    const wrapper = screen.getByTestId("log-time-btn").parentElement!;
    expect(wrapper.className).toContain("focus-within:opacity-100");
  });
});
