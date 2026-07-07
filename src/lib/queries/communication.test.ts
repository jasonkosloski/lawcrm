/**
 * Integration tests for listThreadsForEmail — the lead Communication
 * tab's address-based thread matcher.
 *
 * The query is a two-pass design: a capped candidate fetch (exact
 * sender match in SQL, loose substring hit on the recipient JSON)
 * plus a message-scoped verification pass. These tests pin the
 * exactness guarantee (a substring collision like "bjoe@x.com" must
 * NOT surface for "joe@x.com"), case-insensitive matching on both
 * sender and recipients, account scoping, and that fromDisplay stays
 * the thread's FIRST sender even when the matching message arrives
 * later in the thread (the candidate fetch only loads one message
 * per thread now).
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { listThreadsForEmail } from "@/lib/queries/communication";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
const mockedGetUser = vi.mocked(getCurrentUserId);

let userId: string;
let accountId: string;

async function seedAccount(ownerId: string): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: {
      userId: ownerId,
      emailAddress: `inbox-${Math.random().toString(36).slice(2, 8)}@firm.test`,
    },
    select: { id: true },
  });
  return account.id;
}

async function seedThread(opts: {
  accountId: string;
  subject: string;
  messages: Array<{
    fromName?: string;
    fromEmail: string;
    to?: Array<{ name?: string; email: string }>;
    cc?: Array<{ name?: string; email: string }>;
    sentAt: string;
  }>;
}): Promise<string> {
  const last = opts.messages[opts.messages.length - 1];
  const thread = await prisma.emailThread.create({
    data: {
      accountId: opts.accountId,
      subject: opts.subject,
      messageCount: opts.messages.length,
      lastMessageAt: new Date(last.sentAt),
      messages: {
        create: opts.messages.map((m) => ({
          fromName: m.fromName ?? m.fromEmail,
          fromEmail: m.fromEmail,
          toRecipients: JSON.stringify(m.to ?? []),
          ccRecipients: m.cc ? JSON.stringify(m.cc) : null,
          body: "test body",
          sentAt: new Date(m.sentAt),
        })),
      },
    },
    select: { id: true },
  });
  return thread.id;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  mockedGetUser.mockResolvedValue(userId);
  accountId = await seedAccount(userId);
});

describe("listThreadsForEmail", () => {
  test("matches sender and recipients case-insensitively", async () => {
    await seedThread({
      accountId,
      subject: "From the lead",
      messages: [
        {
          fromEmail: "Lead@Example.com",
          to: [{ email: "me@firm.test" }],
          sentAt: "2026-06-01T10:00",
        },
      ],
    });
    await seedThread({
      accountId,
      subject: "To the lead (cc)",
      messages: [
        {
          fromEmail: "me@firm.test",
          to: [{ email: "other@firm.test" }],
          cc: [{ name: "The Lead", email: "LEAD@example.COM" }],
          sentAt: "2026-06-02T10:00",
        },
      ],
    });
    // Noise: unrelated correspondence must not surface.
    await seedThread({
      accountId,
      subject: "Unrelated",
      messages: [
        {
          fromEmail: "someone@else.test",
          to: [{ email: "me@firm.test" }],
          sentAt: "2026-06-03T10:00",
        },
      ],
    });

    const rows = await listThreadsForEmail("lead@example.com");
    // Newest-first ordering, matching the sibling list queries.
    expect(rows.map((r) => r.subject)).toEqual([
      "To the lead (cc)",
      "From the lead",
    ]);
  });

  test("substring collisions in the recipient JSON do not match", async () => {
    // "joe@x.com" is a substring of "bjoe@x.com" — the SQL contains
    // hit alone would surface this thread; verification must drop it.
    await seedThread({
      accountId,
      subject: "Collision",
      messages: [
        {
          fromEmail: "me@firm.test",
          to: [{ email: "bjoe@x.com" }],
          sentAt: "2026-06-01T10:00",
        },
      ],
    });
    await seedThread({
      accountId,
      subject: "True match",
      messages: [
        {
          fromEmail: "me@firm.test",
          to: [{ email: "joe@x.com" }],
          sentAt: "2026-06-02T10:00",
        },
      ],
    });

    const rows = await listThreadsForEmail("joe@x.com");
    expect(rows.map((r) => r.subject)).toEqual(["True match"]);
  });

  test("scopes to the current user's accounts", async () => {
    const { firmId } = await seedFirm({ name: "Other Firm" });
    const { userId: otherUserId } = await seedUser({ firmId });
    const otherAccountId = await seedAccount(otherUserId);
    await seedThread({
      accountId: otherAccountId,
      subject: "Someone else's thread",
      messages: [
        { fromEmail: "lead@example.com", sentAt: "2026-06-01T10:00" },
      ],
    });

    expect(await listThreadsForEmail("lead@example.com")).toEqual([]);
  });

  test("fromDisplay is the thread's first sender even when a later message matches", async () => {
    await seedThread({
      accountId,
      subject: "Lead replies later",
      messages: [
        {
          fromName: "Pat Paralegal",
          fromEmail: "pat@firm.test",
          to: [{ email: "lead@example.com" }],
          sentAt: "2026-06-01T10:00",
        },
        {
          fromName: "The Lead",
          fromEmail: "lead@example.com",
          to: [{ email: "pat@firm.test" }],
          sentAt: "2026-06-02T10:00",
        },
      ],
    });

    const rows = await listThreadsForEmail("lead@example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0].fromDisplay).toBe("Pat Paralegal");
  });

  test("empty email short-circuits to an empty list", async () => {
    expect(await listThreadsForEmail("")).toEqual([]);
  });
});
