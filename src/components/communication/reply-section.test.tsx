/**
 * ReplySection tests (F044) - the composer must be keyed by thread id.
 *
 * Thread selection is a ?thread= search-param navigation, which keeps
 * client component state across the switch. Without a key, a draft +
 * edited recipients typed on thread A would still be in the composer on
 * thread B and Send would post A's content into B. ReplySection is an
 * async server component, so it is awaited directly and the returned
 * element inspected.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailThread: {
      findFirst: vi.fn().mockResolvedValue({
        account: { emailAddress: "me@firm.com", syncStatus: "connected" },
      }),
    },
  },
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn().mockResolvedValue("u1"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("./reply-composer", () => ({
  ReplyComposer: () => null,
}));

import type { ThreadDetail } from "@/lib/queries/communication";
import { currentUserHasPermission } from "@/lib/permission-check";
import { ReplyComposer } from "./reply-composer";
import { ReplySection } from "./reply-section";

function thread(id: string): ThreadDetail {
  return {
    id,
    subject: "Case update",
    matter: null,
    labels: [],
    messageCount: 1,
    lastMessageAt: new Date("2026-07-01T10:00:00Z"),
    followUpAt: null,
    messages: [
      {
        id: `m-${id}`,
        fromName: "Alice",
        fromEmail: "alice@example.com",
        toRecipients: [{ email: "me@firm.com" }],
        ccRecipients: [],
      },
    ],
  } as unknown as ThreadDetail;
}

beforeEach(() => {
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
});

describe("ReplySection", () => {
  test("keys the composer by thread id so a thread switch remounts it", async () => {
    const a = (await ReplySection({ thread: thread("thread-a") })) as {
      type: unknown;
      key: string | null;
      props: { threadId: string };
    };
    const b = (await ReplySection({ thread: thread("thread-b") })) as {
      key: string | null;
      props: { threadId: string };
    };
    expect(a.type).toBe(ReplyComposer);
    expect(a.key).toBe("thread-a");
    expect(b.key).toBe("thread-b");
    expect(a.key).not.toBe(b.key);
    expect(a.props.threadId).toBe("thread-a");
  });

  test("renders nothing without communication.send_email", async () => {
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    expect(await ReplySection({ thread: thread("thread-a") })).toBeNull();
  });
});
