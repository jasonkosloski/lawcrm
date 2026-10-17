/**
 * Integration tests for the on-demand attachment byte cache
 * (`ensureAttachmentBytes`).
 *
 * Real test Postgres + real local storage (temp cwd, dynamic import -
 * same idiom as the download route test); only `gmailFetch` is mocked.
 *
 * Pins the paths the route/action tests don't reach:
 *   - cache race: the loser of the parked -> cached flip deletes its own
 *     copy and adopts the winner's key; a winner that is itself still
 *     parked is a retryable fetch_failed
 *   - a deliberately DISCONNECTED mailbox (no refresh token) reports
 *     "disconnected" WITHOUT calling Gmail, so the account is not flipped
 *     to the "error" sync state
 *   - transient failures (token-refresh 5xx, network TypeError, a
 *     non-JSON 200) map to fetch_failed instead of leaking as raw errors
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/google/gmail-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/google/gmail-client")>();
  return { ...actual, gmailFetch: vi.fn() };
});

import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import { GoogleOAuthError } from "@/lib/google/oauth";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGmailFetch = vi.mocked(gmailFetch);

const TEST_TMP = realpathSync(mkdtempSync(join(tmpdir(), "lawcrm-att-lib-")));
const ORIGINAL_CWD = process.cwd();

type Lib = typeof import("./email-attachments");
type Storage = typeof import("@/lib/file-storage");
let lib: Lib;
let storage: Storage;
let userId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
  process.chdir(TEST_TMP);
  lib = await import("./email-attachments");
  storage = await import("@/lib/file-storage");
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  rmSync(TEST_TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.clearAllMocks();
  rmSync(join(TEST_TMP, "uploads"), { recursive: true, force: true });
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
});

function storedFileCount(): number {
  try {
    return readdirSync(join(TEST_TMP, "uploads"), {
      recursive: true,
      withFileTypes: true,
    }).filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

async function seedParked(opts?: {
  refreshToken?: string | null;
  syncStatus?: string;
}): Promise<{ attachmentId: string; accountId: string }> {
  const account = await prisma.emailAccount.create({
    data: {
      userId,
      emailAddress: "box@example.com",
      refreshToken:
        opts?.refreshToken === undefined ? "enc-refresh" : opts.refreshToken,
      syncStatus: opts?.syncStatus ?? "connected",
    },
    select: { id: true },
  });
  const thread = await prisma.emailThread.create({
    data: {
      accountId: account.id,
      subject: "Attached",
      lastMessageAt: new Date("2026-06-01T10:00:00Z"),
    },
    select: { id: true },
  });
  const message = await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      externalId: "mid-1",
      fromName: "S",
      fromEmail: "s@example.com",
      toRecipients: "[]",
      body: "",
      sentAt: new Date("2026-06-01T10:00:00Z"),
    },
    select: { id: true },
  });
  const attachment = await prisma.emailAttachment.create({
    data: {
      messageId: message.id,
      filename: "scan.pdf",
      contentType: "application/pdf",
      fileSize: 3,
      fileUrl: "gmail:aid-1",
    },
    select: { id: true },
  });
  return { attachmentId: attachment.id, accountId: account.id };
}

function payload(bytes: string): Response {
  return new Response(
    JSON.stringify({ data: Buffer.from(bytes).toString("base64url") }),
    { status: 200 }
  );
}

describe("ensureAttachmentBytes - cache race", () => {
  test("the loser deletes its own copy and adopts the winner's key", async () => {
    const { attachmentId } = await seedParked();
    mockedGmailFetch.mockResolvedValue(payload("LOSER-BYTES"));

    // A concurrent request cached first: its copy exists in storage and
    // the row already points at it by the time our conditional flip runs.
    const winner = await storage.storeFile(new File(["WINNER"], "scan.pdf"));
    const realUpdateMany = prisma.emailAttachment.updateMany.bind(
      prisma.emailAttachment
    );
    const spy = vi
      .spyOn(prisma.emailAttachment, "updateMany")
      .mockImplementationOnce((async () => {
        await prisma.emailAttachment.update({
          where: { id: attachmentId },
          data: { fileUrl: winner.key, fileSize: winner.size },
        });
        return realUpdateMany({
          where: { id: attachmentId, fileUrl: "gmail:aid-1" },
          data: { fileUrl: "never" },
        });
      }) as never);

    const { key } = await lib.ensureAttachmentBytes(attachmentId);
    spy.mockRestore();

    expect(key).toBe(winner.key);
    // Our duplicate was removed: only the winner's copy remains.
    expect(storedFileCount()).toBe(1);
    const row = await prisma.emailAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(row.fileUrl).toBe(winner.key);
  });

  test("a loser whose winner is still parked is a retryable fetch_failed", async () => {
    const { attachmentId } = await seedParked();
    mockedGmailFetch.mockResolvedValue(payload("BYTES"));
    const spy = vi
      .spyOn(prisma.emailAttachment, "updateMany")
      .mockResolvedValueOnce({ count: 0 });

    await expect(lib.ensureAttachmentBytes(attachmentId)).rejects.toMatchObject(
      { name: "AttachmentBytesError", code: "fetch_failed" }
    );
    spy.mockRestore();
    expect(storedFileCount()).toBe(0); // our copy was cleaned up
  });
});

describe("ensureAttachmentBytes - disconnected mailbox (F669)", () => {
  test("no refresh token -> 'disconnected' with ZERO Gmail calls and the sync state untouched", async () => {
    const { attachmentId, accountId } = await seedParked({
      refreshToken: null,
      syncStatus: "disconnected",
    });

    await expect(lib.ensureAttachmentBytes(attachmentId)).rejects.toMatchObject(
      { code: "disconnected" }
    );

    expect(mockedGmailFetch).not.toHaveBeenCalled();
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { syncStatus: true, syncError: true },
    });
    expect(account.syncStatus).toBe("disconnected");
    expect(account.syncError).toBeNull();
  });

  test("a real revocation (GmailAuthError with a token on file) still maps to 'disconnected'", async () => {
    const { attachmentId, accountId } = await seedParked();
    mockedGmailFetch.mockRejectedValue(new GmailAuthError("revoked", accountId));
    await expect(lib.ensureAttachmentBytes(attachmentId)).rejects.toMatchObject(
      { code: "disconnected" }
    );
  });
});

describe("ensureAttachmentBytes - transient failures (F670)", () => {
  test.each([
    ["token-refresh 5xx", () => new GoogleOAuthError("503", null, 503)],
    ["network TypeError", () => new TypeError("fetch failed")],
  ])("%s -> fetch_failed", async (_name, make) => {
    const { attachmentId } = await seedParked();
    mockedGmailFetch.mockRejectedValue(make());
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(lib.ensureAttachmentBytes(attachmentId)).rejects.toMatchObject(
      { name: "AttachmentBytesError", code: "fetch_failed" }
    );
    errSpy.mockRestore();
    // Parked id survives for a retry.
    const row = await prisma.emailAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(row.fileUrl).toBe("gmail:aid-1");
  });

  test("a 200 whose body is not JSON -> fetch_failed", async () => {
    const { attachmentId } = await seedParked();
    mockedGmailFetch.mockResolvedValue(new Response("<html>gateway</html>"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(lib.ensureAttachmentBytes(attachmentId)).rejects.toMatchObject(
      { code: "fetch_failed" }
    );
    errSpy.mockRestore();
  });

  test("an unrecognised error is still rethrown (a programming error must not be masked)", async () => {
    const { attachmentId } = await seedParked();
    mockedGmailFetch.mockRejectedValue(new RangeError("bug"));
    await expect(lib.ensureAttachmentBytes(attachmentId)).rejects.toThrow(
      "bug"
    );
  });
});
