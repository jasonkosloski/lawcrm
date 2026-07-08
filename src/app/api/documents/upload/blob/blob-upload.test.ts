// @vitest-environment node
/**
 * Unit tests for the client-direct blob upload callbacks.
 *
 * `handleUpload` itself (signature verification, event dispatch) is
 * Vercel's code — we test OUR callbacks directly, which is where
 * every gate and every DB write lives:
 *
 *   onBeforeGenerateToken — session/permission gates, pathname
 *   shape check, matter/folder validation (incl. cross-matter
 *   folder scoping), extension-derived allowedContentTypes +
 *   per-type size caps, and the tokenPayload round-trip.
 *
 *   onUploadCompleted — Document row creation contract, size via
 *   head(), empty-upload cleanup, audit + revalidation.
 *
 * HONESTY NOTE: prisma is MOCKED here — these tests pin the
 * *argument contract* of document.create, not real DB behavior.
 * They also cannot exercise the Vercel→route callback delivery
 * itself (that only happens on a public deployment; localhost never
 * receives it — the very reason the streaming route still exists).
 */

import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    matter: { findUnique: vi.fn() },
    documentFolder: { findFirst: vi.fn() },
    document: { create: vi.fn() },
  },
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return { ...actual, del: vi.fn(), head: vi.fn() };
});

import { del, head } from "@vercel/blob";
import { auth } from "@/auth";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
} from "../upload-config";
import {
  UploadTokenError,
  onBeforeGenerateToken,
  onUploadCompleted,
} from "./blob-upload";

const mockedAuth = vi.mocked(auth);
const mockedPerm = vi.mocked(currentUserHasPermission);
const mockedMatter = vi.mocked(prisma.matter.findUnique);
const mockedFolder = vi.mocked(prisma.documentFolder.findFirst);
const mockedCreate = vi.mocked(prisma.document.create);
const mockedHead = vi.mocked(head);
const mockedDel = vi.mocked(del);

const KEY = "AAAAAAAAAAAAAAAA__brief.pdf";
const PAYLOAD = JSON.stringify({
  matterId: "m1",
  folderId: "fold1",
  name: "brief.pdf",
});

function wireHappyGates() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
  mockedPerm.mockResolvedValue(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedMatter.mockResolvedValue({ id: "m1" } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedFolder.mockResolvedValue({ id: "fold1" } as any);
}

/** Await the rejection and hand back the UploadTokenError. */
async function tokenError(
  pathname: string,
  clientPayload: string | null
): Promise<UploadTokenError> {
  const err = await onBeforeGenerateToken(pathname, clientPayload, false).then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(UploadTokenError);
  return err as UploadTokenError;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("onBeforeGenerateToken — gates", () => {
  test("no session → 401", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue(null as any);
    const err = await tokenError(KEY, PAYLOAD);
    expect(err.status).toBe(401);
  });

  test("no documents.upload permission → 403", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedPerm.mockResolvedValue(false);
    const err = await tokenError(KEY, PAYLOAD);
    expect(err.status).toBe(403);
    expect(mockedPerm).toHaveBeenCalledWith("documents.upload");
  });

  test("pathname outside the key scheme → 400 (no fake folders, no traversal)", async () => {
    wireHappyGates();
    for (const bad of [
      "evil/../x.pdf",
      "plain-name.pdf",
      "AAAAAAAAAAAAAAAA__a/b.pdf",
    ]) {
      const err = await tokenError(bad, PAYLOAD);
      expect(err.status, bad).toBe(400);
    }
    // Rejected before any DB lookup.
    expect(mockedMatter).not.toHaveBeenCalled();
  });

  test("malformed clientPayload → 400", async () => {
    wireHappyGates();
    for (const bad of [null, "not json", JSON.stringify({ folderId: "f" })]) {
      const err = await tokenError(KEY, bad);
      expect(err.status).toBe(400);
    }
  });

  test("unknown matter → 404", async () => {
    wireHappyGates();
    mockedMatter.mockResolvedValue(null);
    const err = await tokenError(KEY, PAYLOAD);
    expect(err.status).toBe(404);
  });

  test("folder from a DIFFERENT matter → 400 (scoped lookup)", async () => {
    wireHappyGates();
    mockedFolder.mockResolvedValue(null);
    const err = await tokenError(KEY, PAYLOAD);
    expect(err.status).toBe(400);
    // The scoping IS the security property: id alone must not match.
    expect(mockedFolder).toHaveBeenCalledWith({
      where: { id: "fold1", matterId: "m1" },
      select: { id: true },
    });
  });
});

describe("onBeforeGenerateToken — token contract", () => {
  test("pdf: allowedContentTypes from the extension map + standard cap", async () => {
    wireHappyGates();
    const token = await onBeforeGenerateToken(KEY, PAYLOAD, false);
    expect(token.allowedContentTypes).toEqual(["application/pdf"]);
    expect(token.maximumSizeInBytes).toBe(MAX_STANDARD_UPLOAD_BYTES);
    expect(token.addRandomSuffix).toBe(false);
    expect(token.allowOverwrite).toBe(false);
  });

  test("mp4: media type gets the media cap", async () => {
    wireHappyGates();
    const token = await onBeforeGenerateToken(
      "AAAAAAAAAAAAAAAA__bodycam.mp4",
      JSON.stringify({ matterId: "m1", folderId: null, name: "bodycam.mp4" }),
      false
    );
    expect(token.allowedContentTypes).toEqual(["video/mp4"]);
    expect(token.maximumSizeInBytes).toBe(MAX_MEDIA_UPLOAD_BYTES);
  });

  test("unknown extension: octet-stream + standard cap (same rule as streaming route)", async () => {
    wireHappyGates();
    const token = await onBeforeGenerateToken(
      "AAAAAAAAAAAAAAAA__mystery.xyz",
      JSON.stringify({ matterId: "m1", name: "mystery.xyz" }),
      false
    );
    expect(token.allowedContentTypes).toEqual(["application/octet-stream"]);
    expect(token.maximumSizeInBytes).toBe(MAX_STANDARD_UPLOAD_BYTES);
  });

  test("tokenPayload round-trips target + identity + derived MIME", async () => {
    wireHappyGates();
    const token = await onBeforeGenerateToken(KEY, PAYLOAD, false);
    expect(JSON.parse(token.tokenPayload as string)).toEqual({
      matterId: "m1",
      folderId: "fold1",
      name: "brief.pdf",
      contentType: "application/pdf",
      userId: "u1", // from the SESSION, never the client payload
    });
  });

  test("root uploads carry folderId: null", async () => {
    wireHappyGates();
    const token = await onBeforeGenerateToken(
      KEY,
      JSON.stringify({ matterId: "m1", name: "brief.pdf" }),
      false
    );
    expect(JSON.parse(token.tokenPayload as string).folderId).toBeNull();
    // No folder lookup when there's nothing to scope.
    expect(mockedFolder).not.toHaveBeenCalled();
  });
});

describe("onUploadCompleted", () => {
  const BLOB = {
    url: `https://abc123.public.blob.vercel-storage.com/${KEY}`,
    downloadUrl: "",
    pathname: KEY,
    contentType: "application/pdf",
    contentDisposition: "inline",
    etag: "e1",
  };
  const TOKEN_PAYLOAD = JSON.stringify({
    matterId: "m1",
    folderId: "fold1",
    name: "brief.pdf",
    contentType: "application/pdf",
    userId: "u1",
  });

  test("creates the Document row with the blob URL as fileUrl", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 9876 } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreate.mockResolvedValue({ id: "d1" } as any);

    await onUploadCompleted({ blob: BLOB, tokenPayload: TOKEN_PAYLOAD });

    expect(mockedHead).toHaveBeenCalledWith(BLOB.url);
    expect(mockedCreate).toHaveBeenCalledWith({
      data: {
        matterId: "m1",
        folderId: "fold1",
        name: "brief.pdf",
        category: "discovery",
        source: "upload",
        fileUrl: BLOB.url,
        contentType: "application/pdf",
        fileSize: 9876,
        uploadedBy: "u1",
      },
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/matters/m1/documents");
    expect(revalidatePath).toHaveBeenCalledWith("/matters/m1");
  });

  test("empty upload: blob deleted, NO row created (streaming-route parity)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 0 } as any);
    mockedDel.mockResolvedValue(undefined);
    await onUploadCompleted({ blob: BLOB, tokenPayload: TOKEN_PAYLOAD });
    expect(mockedDel).toHaveBeenCalledWith(BLOB.url);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  test("missing tokenPayload throws (Vercel will retry; we never guess identity)", async () => {
    await expect(
      onUploadCompleted({ blob: BLOB, tokenPayload: null })
    ).rejects.toThrow(/token payload/i);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
