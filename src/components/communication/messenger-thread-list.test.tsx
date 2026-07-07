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
    lastCallStatus: null,
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
      "inbound answered call → PhoneIncoming",
      makeThread({
        lastKind: "call",
        lastDirection: "inbound",
        lastBody: "Inbound call",
        lastCallStatus: "answered",
      }),
      "lucide-phone-incoming",
    ],
    [
      "outbound call → PhoneOutgoing",
      makeThread({
        lastKind: "call",
        lastDirection: "outbound",
        lastBody: "Outbound call",
        lastCallStatus: "answered",
      }),
      "lucide-phone-outgoing",
    ],
    [
      "missed call → PhoneMissed",
      makeThread({
        lastKind: "call",
        lastDirection: "inbound",
        lastBody: "Missed call",
        lastCallStatus: "missed",
      }),
      "lucide-phone-missed",
    ],
    [
      // Regression: the old check compared lastBody to the literal
      // string "Missed call", so a no_answer call never got flagged.
      "no_answer call → PhoneMissed",
      makeThread({
        lastKind: "call",
        lastDirection: "inbound",
        lastBody: "Missed call",
        lastCallStatus: "no_answer",
      }),
      "lucide-phone-missed",
    ],
    [
      // Regression: a missed call whose summary was logged into body
      // used to lose the missed glyph because body !== "Missed call".
      "missed call with summary body → PhoneMissed",
      makeThread({
        lastKind: "call",
        lastDirection: "inbound",
        lastBody: "Client called about the deposition",
        lastCallStatus: "missed",
      }),
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
      makeThread({
        lastKind: "call",
        lastDirection: "inbound",
        lastBody: "Missed call",
        lastCallStatus: "missed",
      })
    );
    expect(getByText("Missed call").className).toContain("text-warn");
  });

  test("no_answer call with a summary body still gets the missed treatment", () => {
    const { getByText, container } = renderList(
      makeThread({
        lastKind: "call",
        lastDirection: "inbound",
        lastBody: "Tried to reach the office",
        lastCallStatus: "no_answer",
      })
    );
    expect(container.querySelector(".lucide-phone-missed")).not.toBeNull();
    expect(getByText("Tried to reach the office").className).toContain(
      "text-warn"
    );
  });

  test("answered call with a summary body does not get the missed treatment", () => {
    const { getByText, container } = renderList(
      makeThread({
        lastKind: "call",
        lastDirection: "inbound",
        lastBody: "Discussed settlement terms",
        lastCallStatus: "answered",
      })
    );
    expect(container.querySelector(".lucide-phone-missed")).toBeNull();
    expect(container.querySelector(".lucide-phone-incoming")).not.toBeNull();
    expect(getByText("Discussed settlement terms").className).not.toContain(
      "text-warn"
    );
  });

  test("busy inbound call renders neutrally (matches reader / phone log)", () => {
    const { container } = renderList(
      makeThread({
        lastKind: "call",
        lastDirection: "inbound",
        lastBody: "Inbound call",
        lastCallStatus: "busy",
      })
    );
    expect(container.querySelector(".lucide-phone-missed")).toBeNull();
    expect(container.querySelector(".lucide-phone-incoming")).not.toBeNull();
  });
});
