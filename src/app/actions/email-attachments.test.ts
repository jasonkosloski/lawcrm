/**
 * Integration tests for the email attachment→documents bridge.
 *
 * Real test Postgres + real local storage (temp cwd, dynamic import
 * — same idiom as the download route test); permission gate,
 * revalidation, and `gmailFetch` are mocked.
 *
 * Pins:
 *   - the gate asks for `documents.upload`
 *   - scoping: another user's attachment / cross-matter folder are
 *     refused
 *   - Document row shape: category "correspondence", source
 *     "email", name = attachment filename, contentType RE-DERIVED
 *     from the filename extension (never the sender-declared MIME),
 *     uploadedBy set, folderId honored
 *   - bytes are an independent COPY: Document.fileUrl differs from
 *     the attachment's cached key (a Document delete unlinks its
 *     fileUrl — sharing keys would break the other references)
 *   - dedupe: re-filing the same attachment to the same matter
 *     no-ops (`alreadyFiled: true`, no second row/activity entry);
 *     filing to a DIFFERENT matter creates an independent copy
 *   - disconnected + uncached → friendly error, nothing created
 *   - activity log: "Filed email attachment" on the matter
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/google/gmail-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/google/gmail-client")>();
  return { ...actual, gmailFetch: vi.fn() };
});

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permission-check";
import { getCurrentUserId } from "@/lib/current-user";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedDocumentFolder,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGmailFetch = vi.mocked(gmailFetch);

const TEST_TMP = realpathSync(mkdtempSync(join(tmpdir(), "lawcrm-file-att-")));
const ORIGINAL_CWD = process.cwd();

type Actions = typeof import("./email-attachments");
let actions: Actions;

let userId: string;
let matterId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
  process.chdir(TEST_TMP);
  // Import after chdir so the local storage driver roots under the
  // temp dir.
  actions = await import("./email-attachments");
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
  vi.mocked(requirePermission).mockResolvedValue(userId);
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
});

/** Parked attachment (default) in a mailbox. Sender-declared
 *  contentType is deliberately hostile (text/html) so the re-
 *  derivation assertion means something. */
async function seedAttachment(opts?: {
  ownerUserId?: string;
  filename?: string;
  fileUrl?: string;
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
      subject: "Attached",
      lastMessageAt: new Date(),
    },
    select: { id: true },
  });
  const message = await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      externalId: "mid-1",
      fromName: "Sender",
      fromEmail: "s@example.com",
      toRecipients: "[]",
      body: "",
      sentAt: new Date(),
    },
    select: { id: true },
  });
  const attachment = await prisma.emailAttachment.create({
    data: {
      messageId: message.id,
      filename: opts?.filename ?? "scan.pdf",
      contentType: "text/html", // sender-declared lie
      fileSize: 3,
      fileUrl: opts?.fileUrl ?? "gmail:aid-1",
    },
    select: { id: true },
  });
  return attachment.id;
}

function gmailPayload(bytes: string): Response {
  return new Response(
    JSON.stringify({ data: Buffer.from(bytes).toString("base64url") }),
    { status: 200 }
  );
}

describe("gate + scoping", () => {
  test("asks for documents.upload", async () => {
    const attachmentId = await seedAttachment();
    mockedGmailFetch.mockResolvedValue(gmailPayload("PDF"));
    await actions.fileAttachmentToMatter(attachmentId, matterId);
    expect(requirePermission).toHaveBeenCalledWith("documents.upload");
  });

  test("another user's attachment is refused (owner-scoped like the read model)", async () => {
    const { firmId } = await seedFirm({ name: "Other" });
    const other = await seedUser({ firmId });
    const attachmentId = await seedAttachment({ ownerUserId: other.userId });
    const res = await actions.fileAttachmentToMatter(attachmentId, matterId);
    expect(res).toEqual({ ok: false, error: "Attachment not found." });
    expect(await prisma.document.count()).toBe(0);
  });

  test("unknown matter", async () => {
    const attachmentId = await seedAttachment();
    const res = await actions.fileAttachmentToMatter(attachmentId, "nope");
    expect(res).toEqual({ ok: false, error: "Matter not found." });
  });

  test("a folder from a DIFFERENT matter must not leak the file into it", async () => {
    const attachmentId = await seedAttachment();
    const { areaId, stageId } = await seedPracticeArea({ name: "Area B" });
    const otherMatter = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const { folderId } = await seedDocumentFolder({
      matterId: otherMatter.matterId,
      name: "Foreign",
    });
    const res = await actions.fileAttachmentToMatter(
      attachmentId,
      matterId,
      folderId
    );
    expect(res).toEqual({
      ok: false,
      error: "Folder not found in this matter.",
    });
    expect(await prisma.document.count()).toBe(0);
  });
});

describe("filing", () => {
  test("creates the Document (fetching + caching bytes on the way) with the documented shape", async () => {
    const attachmentId = await seedAttachment({ filename: "scan.pdf" });
    const { folderId } = await seedDocumentFolder({
      matterId,
      name: "Correspondence",
    });
    mockedGmailFetch.mockResolvedValue(gmailPayload("PDF-BYTES"));

    const res = await actions.fileAttachmentToMatter(
      attachmentId,
      matterId,
      folderId
    );
    expect(res).toEqual({ ok: true });

    const doc = await prisma.document.findFirstOrThrow();
    expect(doc.matterId).toBe(matterId);
    expect(doc.folderId).toBe(folderId);
    expect(doc.name).toBe("scan.pdf");
    expect(doc.category).toBe("correspondence");
    expect(doc.source).toBe("email");
    // Server-side re-derivation from the extension — the sender-
    // declared "text/html" is never trusted onto the Document.
    expect(doc.contentType).toBe("application/pdf");
    expect(doc.fileSize).toBe("PDF-BYTES".length);
    expect(doc.uploadedBy).toBe(userId);

    // Independent copy: the Document's key differs from the
    // attachment's cached key, so deleting either can't orphan the
    // other's bytes.
    const attachment = await prisma.emailAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(attachment.fileUrl).not.toMatch(/^gmail:/); // cached as a side effect
    expect(doc.fileUrl).toBeTruthy();
    expect(doc.fileUrl).not.toBe(attachment.fileUrl);

    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { type: "document" },
    });
    expect(activity.matterId).toBe(matterId);
    expect(activity.userId).toBe(userId);
    expect(activity.title).toBe("Filed email attachment");
    expect(activity.detail).toBe("scan.pdf");

    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/documents`
    );
  });

  test("re-filing the same attachment to the same matter no-ops with alreadyFiled", async () => {
    const attachmentId = await seedAttachment();
    mockedGmailFetch.mockResolvedValue(gmailPayload("PDF-BYTES"));

    expect(
      await actions.fileAttachmentToMatter(attachmentId, matterId)
    ).toEqual({ ok: true });
    const again = await actions.fileAttachmentToMatter(
      attachmentId,
      matterId
    );
    expect(again).toEqual({ ok: true, alreadyFiled: true });

    // No duplicate row, no duplicate audit entry — and the bytes
    // were only ever fetched from Gmail once.
    expect(await prisma.document.count()).toBe(1);
    expect(await prisma.activityLog.count()).toBe(1);
    expect(mockedGmailFetch).toHaveBeenCalledTimes(1);
  });

  test("filing to a SECOND matter creates an independent copy", async () => {
    const attachmentId = await seedAttachment();
    mockedGmailFetch.mockResolvedValue(gmailPayload("PDF-BYTES"));
    const { areaId, stageId } = await seedPracticeArea({ name: "Area C" });
    const second = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });

    await actions.fileAttachmentToMatter(attachmentId, matterId);
    const res = await actions.fileAttachmentToMatter(
      attachmentId,
      second.matterId
    );
    expect(res).toEqual({ ok: true });

    const docs = await prisma.document.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(docs).toHaveLength(2);
    expect(docs[0].fileUrl).not.toBe(docs[1].fileUrl);
    // Cached once — the second filing copies from storage, not Gmail.
    expect(mockedGmailFetch).toHaveBeenCalledTimes(1);
  });

  test("disconnected + uncached → friendly reconnect error, nothing created", async () => {
    const attachmentId = await seedAttachment();
    mockedGmailFetch.mockRejectedValue(
      new GmailAuthError("revoked", "acct-1")
    );
    const res = await actions.fileAttachmentToMatter(attachmentId, matterId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/[Rr]econnect/);
    expect(await prisma.document.count()).toBe(0);
    expect(await prisma.activityLog.count()).toBe(0);
  });
});

describe("listMatterFolders", () => {
  test("returns the flattened tree, depth-ordered for indentation", async () => {
    const parent = await seedDocumentFolder({ matterId, name: "Discovery" });
    await seedDocumentFolder({
      matterId,
      name: "Productions",
      parentId: parent.folderId,
    });
    await seedDocumentFolder({ matterId, name: "Pleadings", order: 1 });

    const rows = await actions.listMatterFolders(matterId);
    expect(rows.map((r) => ({ name: r.name, depth: r.depth }))).toEqual([
      { name: "Discovery", depth: 1 },
      { name: "Productions", depth: 2 },
      { name: "Pleadings", depth: 1 },
    ]);
  });
});
