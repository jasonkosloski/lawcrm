/**
 * Integration tests for GET /api/email-attachments/[id]/download.
 *
 * Real test Postgres + real local storage (temp cwd); `gmailFetch`
 * and `auth` are mocked. Pins the Email v1.1 byte contract:
 *
 *   - fetch-and-cache: first download pulls bytes from Gmail
 *     (base64url payload), stores them, and flips `fileUrl` from
 *     `gmail:<id>` to a storage key EXACTLY once; the second
 *     download makes ZERO Gmail calls.
 *   - disconnected + uncached → 409 with a reconnect message (and
 *     the parked fileUrl untouched, so a reconnect can retry).
 *   - inline-allowlist parity with the documents route (shared
 *     `isInlineSafeType`): sender-declared text/html is forced to
 *     attachment + CSP sandbox; pdf previews inline; nosniff always.
 *   - scoping matches the inbox read model: another user's
 *     attachment is a 404 (mailbox-personal, like getThreadById).
 *   - Range requests work against the cached bytes (shared range
 *     resolver + local driver's ranged reads).
 *
 * Storage note: the local driver resolves STORAGE_ROOT from
 * process.cwd() at module load, so the route (and everything that
 * pulls in file-storage) is imported DYNAMICALLY after chdir'ing
 * into a temp dir — same idiom as file-storage.test.ts.
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
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/google/gmail-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/google/gmail-client")>();
  return { ...actual, gmailFetch: vi.fn() };
});

import { auth } from "@/auth";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedAuth = vi.mocked(auth);
const mockedGmailFetch = vi.mocked(gmailFetch);

const TEST_TMP = realpathSync(mkdtempSync(join(tmpdir(), "lawcrm-attach-")));
const ORIGINAL_CWD = process.cwd();

type RouteModule = typeof import("./route");
type StorageModule = typeof import("@/lib/file-storage");
let route: RouteModule;
let storage: StorageModule;

let userId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
  process.chdir(TEST_TMP);
  // Dynamic import AFTER chdir so the local driver's STORAGE_ROOT
  // resolves under the temp dir, not the repo's ./uploads.
  route = await import("./route");
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedAuth.mockResolvedValue({ user: { id: userId } } as any);
});

/** Account → thread → message → attachment chain. Defaults to a
 *  parked (`gmail:aid-1`) pdf owned by the session user. */
async function seedAttachment(opts?: {
  ownerUserId?: string;
  fileUrl?: string | null;
  contentType?: string | null;
  filename?: string;
  externalId?: string | null;
}): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: {
      userId: opts?.ownerUserId ?? userId,
      emailAddress: `box-${Math.random().toString(36).slice(2, 8)}@example.com`,
    },
    select: { id: true },
  });
  const thread = await prisma.emailThread.create({
    data: {
      accountId: account.id,
      subject: "Discovery",
      lastMessageAt: new Date(),
    },
    select: { id: true },
  });
  const message = await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      externalId: opts?.externalId === undefined ? "mid-1" : opts.externalId,
      fromName: "Opposing Counsel",
      fromEmail: "oc@example.com",
      toRecipients: "[]",
      body: "See attached.",
      sentAt: new Date(),
    },
    select: { id: true },
  });
  const attachment = await prisma.emailAttachment.create({
    data: {
      messageId: message.id,
      filename: opts?.filename ?? "brief.pdf",
      contentType:
        opts?.contentType === undefined ? "application/pdf" : opts.contentType,
      fileSize: 10,
      fileUrl: opts?.fileUrl === undefined ? "gmail:aid-1" : opts.fileUrl,
    },
    select: { id: true },
  });
  return attachment.id;
}

/** Seed an attachment whose bytes are ALREADY in storage. */
async function seedCachedAttachment(opts: {
  bytes: string;
  contentType: string | null;
  filename?: string;
}): Promise<string> {
  const stored = await storage.storeFile(
    new File([opts.bytes], opts.filename ?? "cached.bin")
  );
  return seedAttachment({
    fileUrl: stored.key,
    contentType: opts.contentType,
    filename: opts.filename ?? "cached.bin",
  });
}

function gmailPayload(bytes: string): Response {
  return new Response(
    JSON.stringify({
      size: bytes.length,
      data: Buffer.from(bytes).toString("base64url"),
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

async function download(
  attachmentId: string,
  headers?: Record<string, string>
): Promise<Response> {
  const req = new Request(
    `http://localhost/api/email-attachments/${attachmentId}/download`,
    { headers }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return route.GET(req as any, {
    params: Promise.resolve({ id: attachmentId }),
  });
}

describe("auth + scoping", () => {
  test("401 without a session", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue(null as any);
    const res = await download("whatever");
    expect(res.status).toBe(401);
  });

  test("another user's attachment is a 404 — mailbox-personal, matching getThreadById", async () => {
    const { firmId } = await seedFirm({ name: "Other Firm" });
    const other = await seedUser({ firmId });
    const attachmentId = await seedAttachment({ ownerUserId: other.userId });
    const res = await download(attachmentId);
    expect(res.status).toBe(404);
    // Never even asks Gmail for something the viewer can't read.
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("attachment with no Gmail id on record (fileUrl null) → 404", async () => {
    const attachmentId = await seedAttachment({ fileUrl: null });
    const res = await download(attachmentId);
    expect(res.status).toBe(404);
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });
});

describe("fetch-and-cache", () => {
  test("first download fetches from Gmail, caches, and flips fileUrl exactly once", async () => {
    const attachmentId = await seedAttachment();
    mockedGmailFetch.mockResolvedValue(gmailPayload("PDF-BYTES"));

    const first = await download(attachmentId);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("PDF-BYTES");
    expect(mockedGmailFetch).toHaveBeenCalledTimes(1);
    // The seam: users/me/messages/{mid}/attachments/{aid}.
    expect(mockedGmailFetch.mock.calls[0][1]).toBe(
      "/users/me/messages/mid-1/attachments/aid-1"
    );

    const row = await prisma.emailAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(row.fileUrl).not.toMatch(/^gmail:/);
    expect(row.fileUrl).toBeTruthy();
    // True decoded byte count backfills the Gmail-claimed size.
    expect(row.fileSize).toBe("PDF-BYTES".length);

    // Second download: served from cache, ZERO further Gmail calls,
    // fileUrl stable.
    const second = await download(attachmentId);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("PDF-BYTES");
    expect(mockedGmailFetch).toHaveBeenCalledTimes(1);
    const rowAfter = await prisma.emailAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(rowAfter.fileUrl).toBe(row.fileUrl);
  });

  test("disconnected account + uncached bytes → 409 with a reconnect message", async () => {
    const attachmentId = await seedAttachment();
    mockedGmailFetch.mockRejectedValue(
      new GmailAuthError("reconnect required", "acct-1")
    );
    const res = await download(attachmentId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/[Rr]econnect/);
    // Parked id survives so a later reconnect can still fetch.
    const row = await prisma.emailAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(row.fileUrl).toBe("gmail:aid-1");
  });

  test("Gmail non-OK response → 502, nothing cached", async () => {
    const attachmentId = await seedAttachment();
    mockedGmailFetch.mockResolvedValue(new Response("nope", { status: 500 }));
    const res = await download(attachmentId);
    expect(res.status).toBe(502);
    const row = await prisma.emailAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(row.fileUrl).toBe("gmail:aid-1");
  });
});

describe("inline-allowlist parity with the documents route", () => {
  test("sender-declared text/html → attachment + CSP sandbox + nosniff", async () => {
    const attachmentId = await seedCachedAttachment({
      bytes: "<script>alert(1)</script>",
      contentType: "text/html",
      filename: "invoice.html",
    });
    const res = await download(attachmentId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("MIME parameters can't smuggle past the allowlist", async () => {
    const attachmentId = await seedCachedAttachment({
      bytes: "x",
      contentType: "text/html; charset=utf-8",
    });
    const res = await download(attachmentId);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });

  test("application/pdf previews inline, no sandbox, nosniff still set", async () => {
    const attachmentId = await seedCachedAttachment({
      bytes: "%PDF-1.7",
      contentType: "application/pdf",
      filename: "brief.pdf",
    });
    const res = await download(attachmentId);
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("missing contentType falls back to octet-stream attachment", async () => {
    const attachmentId = await seedCachedAttachment({
      bytes: "??",
      contentType: null,
    });
    const res = await download(attachmentId);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });
});

describe("Range requests against cached bytes", () => {
  test("bounded range → 206 with the exact inclusive slice", async () => {
    const attachmentId = await seedCachedAttachment({
      bytes: "0123456789",
      contentType: "video/mp4",
      filename: "clip.mp4",
    });
    const res = await download(attachmentId, { range: "bytes=2-5" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");
  });

  test("range past EOF → 416 with the real size", async () => {
    const attachmentId = await seedCachedAttachment({
      bytes: "0123456789",
      contentType: "video/mp4",
      filename: "clip.mp4",
    });
    const res = await download(attachmentId, { range: "bytes=10-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */10");
  });
});
