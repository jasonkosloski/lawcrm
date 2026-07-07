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

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessengerThreadReader } from "./messenger-thread-reader";
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
  InboxActionButtons: () => null,
}));
vi.mock("./comm-time-logged-indicator", () => ({
  CommTimeLoggedIndicator: () => null,
}));
vi.mock("./log-time-on-comm-button", () => ({
  // Marker element so tests can locate the wrapper div whose
  // opacity classes control hover-reveal visibility.
  LogTimeOnCommButton: () => <span data-testid="log-time-btn" />,
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

describe("VoicemailCard duration guard", () => {
  test("a 0-second voicemail renders no stray '0' in the header row", () => {
    render(
      <MessengerThreadReader
        thread={makeThread([
          makeItem({ kind: "voicemail", body: null, callDurationSec: 0 }),
        ])}
      />
    );
    const label = screen.getByText("Voicemail");
    // The buggy `{0 && ...}` rendered "Voicemail" + "0" + time.
    expect(label.parentElement?.textContent).toBe("Voicemail2:05 PM");
  });

  test("a positive duration still renders formatted", () => {
    render(
      <MessengerThreadReader
        thread={makeThread([
          makeItem({ kind: "voicemail", body: null, callDurationSec: 62 }),
        ])}
      />
    );
    expect(screen.getByText("1m 2s")).toBeInTheDocument();
  });
});

describe("mark-as-read island", () => {
  test("opening a thread mounts MarkThreadRead with the messenger channel + thread id", () => {
    render(<MessengerThreadReader thread={makeThread([makeItem({})])} />);
    const island = screen.getByTestId("mark-thread-read");
    expect(island).toHaveAttribute("data-channel", "messenger");
    expect(island).toHaveAttribute("data-thread-id", "thread-1");
  });

  test("the empty state (no thread selected) mounts no island", () => {
    render(<MessengerThreadReader thread={null} />);
    expect(screen.queryByTestId("mark-thread-read")).toBeNull();
  });
});

describe("log-time button hover-reveal (touch visibility)", () => {
  // A bare `opacity-0` (no hover:hover media gate) hides the button
  // forever on touch devices — Tailwind v4's group-hover only fires
  // inside `@media (hover: hover)`, so nothing would reveal it.
  const bareOpacityZero = /(?:^|\s)opacity-0(?:\s|$)/;

  test("SMS bubble hides the button at rest only behind hover:hover", () => {
    render(
      <MessengerThreadReader thread={makeThread([makeItem({})])} />
    );
    const wrapper = screen.getByTestId("log-time-btn").parentElement!;
    expect(wrapper.className).toContain("[@media(hover:hover)]:opacity-0");
    expect(wrapper.className).toContain("group-hover/msg:opacity-100");
    expect(wrapper.className).not.toMatch(bareOpacityZero);
  });

  test("call event hides the button at rest only behind hover:hover", () => {
    render(
      <MessengerThreadReader
        thread={makeThread([
          makeItem({
            kind: "call",
            body: null,
            callStatus: "completed",
            callDurationSec: 90,
          }),
        ])}
      />
    );
    const wrapper = screen.getByTestId("log-time-btn").parentElement!;
    expect(wrapper.className).toContain("[@media(hover:hover)]:opacity-0");
    expect(wrapper.className).toContain("group-hover/call:opacity-100");
    expect(wrapper.className).not.toMatch(bareOpacityZero);
  });
});
