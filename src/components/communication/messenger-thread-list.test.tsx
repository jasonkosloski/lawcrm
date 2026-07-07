/**
 * Tests for MessengerThreadList.
 *
 * The regression worth pinning: the preview icon for call rows used
 * to branch on direction and then return the identical plain
 * `<Phone/>` on both paths — a no-op conditional. Calls now get the
 * same directional/missed glyphs as MatterPhoneLog (PhoneIncoming /
 * PhoneOutgoing / PhoneMissed), so the list and the matter phone
 * log stay visually consistent.
 */

import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";

// Pure anchor stand-in — the list only needs href-based navigation.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The trigger requires MailboxDrawerProvider (client context +
// next/navigation hooks) — irrelevant to icon selection.
vi.mock("./mailbox-drawer", () => ({
  MailboxDrawerTrigger: () => null,
}));

import { MessengerThreadList } from "./messenger-thread-list";
import type { MessengerThreadRow } from "@/lib/queries/messenger";

function makeThread(overrides: Partial<MessengerThreadRow>): MessengerThreadRow {
  return {
    id: "t1",
    contactPhone: "+13035550182",
    contactId: null,
    contactName: "Dana Smith",
    contactType: null,
    defaultMatterId: null,
    defaultMatterName: null,
    defaultMatterColor: null,
    lastBody: "Hello",
    lastKind: "sms",
    lastDirection: "inbound",
    lastAt: new Date("2026-07-01T12:00:00Z"),
    unreadCount: 0,
    isPinned: false,
    isArchived: false,
    followUpAt: null,
    ...overrides,
  };
}

function renderList(thread: MessengerThreadRow) {
  return render(
    <MessengerThreadList
      threads={[thread]}
      filter="all"
      selectedThreadId={null}
    />
  );
}

describe("MessengerThreadList — preview icon per item kind", () => {
  // Lucide stamps each svg with a `lucide-<name>` class — the
  // stable hook for asserting which glyph rendered.
  test.each([
    [
      "inbound call → PhoneIncoming",
      makeThread({ lastKind: "call", lastDirection: "inbound", lastBody: "Inbound call" }),
      "lucide-phone-incoming",
    ],
    [
      "outbound call → PhoneOutgoing",
      makeThread({ lastKind: "call", lastDirection: "outbound", lastBody: "Outbound call" }),
      "lucide-phone-outgoing",
    ],
    [
      "missed call → PhoneMissed",
      makeThread({ lastKind: "call", lastDirection: "inbound", lastBody: "Missed call" }),
      "lucide-phone-missed",
    ],
    [
      "voicemail → Voicemail",
      makeThread({ lastKind: "voicemail", lastBody: "Voicemail" }),
      "lucide-voicemail",
    ],
    [
      "sms → MessageSquare",
      makeThread({ lastKind: "sms", lastBody: "Hello" }),
      "lucide-message-square",
    ],
  ] as const)("%s", (_label, thread, iconClass) => {
    const { container } = renderList(thread);
    expect(container.querySelector(`.${iconClass}`)).not.toBeNull();
  });

  test("missed-call rows style the preview text as warn", () => {
    const { getByText } = renderList(
      makeThread({ lastKind: "call", lastDirection: "inbound", lastBody: "Missed call" })
    );
    expect(getByText("Missed call").className).toContain("text-warn");
  });
});
