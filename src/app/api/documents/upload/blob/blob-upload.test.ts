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
    lead: { findUnique: vi.fn() },
    documentFolder: { findFirst: vi.fn() },
    document: { create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));
vi.mock("@/lib/matter-access", () => ({
  canAccessMatter: vi.fn(async () => true),
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
import { canAccessMatter } from "@/lib/matter-access";
import { revalidatePath } from "next/cache";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
} from "../upload-config";
import { makeStorageKey } from "@/lib/storage/storage-key";
import {
  UploadTokenError,
  onBeforeGenerateToken,
  onUploadCompleted,
} from "./blob-upload";

const mockedAuth = vi.mocked(auth);
const mockedPerm = vi.mocked(currentUserHasPermission);
const mockedMatter = vi.mocked(prisma.matter.findUnique);
const mockedLead = vi.mocked(prisma.lead.findUnique);
const mockedFolder = vi.mocked(prisma.documentFolder.findFirst);
const mockedCreate = vi.mocked(prisma.document.create);
const mockedDocFind = vi.mocked(prisma.document.findFirst);
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
  // mockReset (not clearAllMocks): queued mockResolvedValueOnce
  // values from one test must never leak into the next.
  for (const m of [
    mockedAuth,
    mockedPerm,
    mockedMatter,
    mockedLead,
    mockedFolder,
    mockedCreate,
    mockedDocFind,
    mockedHead,
    mockedDel,
  ]) {
    m.mockReset();
  }
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
      category: "discovery",
      contentType: "application/pdf",
      userId: "u1", // from the SESSION, never the client payload
    });
  });

  test("a composer-chosen category round-trips; an unknown one is rejected", async () => {
    wireHappyGates();
    const token = await onBeforeGenerateToken(
      KEY,
      JSON.stringify({ matterId: "m1", name: "brief.pdf", category: "contract" }),
      false
    );
    expect(JSON.parse(token.tokenPayload as string).category).toBe("contract");

    const err = await tokenError(
      KEY,
      JSON.stringify({ matterId: "m1", name: "brief.pdf", category: "bogus" })
    );
    expect(err.status).toBe(400);
  });

  test("tokens outlive the SDK's one-hour default for media (GB uploads on slow uplinks)", async () => {
    wireHappyGates();
    const before = Date.now();
    const media = await onBeforeGenerateToken(
      "AAAAAAAAAAAAAAAA__bodycam.mp4",
      JSON.stringify({ matterId: "m1", name: "bodycam.mp4" }),
      false
    );
    const pdf = await onBeforeGenerateToken(KEY, PAYLOAD, false);
    const HOUR = 60 * 60 * 1000;
    expect(media.validUntil).toBeGreaterThanOrEqual(before + 6 * HOUR);
    expect(pdf.validUntil).toBeGreaterThanOrEqual(before + HOUR - 1000);
    expect(pdf.validUntil).toBeLessThan(before + 2 * HOUR);
  });

  test("a long-named PDF keeps its type: the key's extension survives truncation", async () => {
    wireHappyGates();
    const key = makeStorageKey("x".repeat(300) + ".pdf");
    const token = await onBeforeGenerateToken(
      key,
      JSON.stringify({ matterId: "m1", name: "x".repeat(200) + ".pdf" }),
      false
    );
    expect(token.allowedContentTypes).toEqual(["application/pdf"]);
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

  /** Gates for a normal first delivery: no existing row, matter and
   *  folder still there. */
  function wireCompletion() {
    mockedDocFind.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedMatter.mockResolvedValue({ id: "m1" } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedFolder.mockResolvedValue({ id: "fold1" } as any);
  }

  test("creates the Document row with the blob URL as fileUrl", async () => {
    wireCompletion();
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
    expect(revalidatePath).toHaveBeenCalledWith(
      "/matters/m1/documents",
      "layout"
    );
    expect(revalidatePath).toHaveBeenCalledWith("/matters/m1");
  });

  test("empty upload: blob deleted, NO row created (streaming-route parity)", async () => {
    wireCompletion();
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

  test("a redelivered callback does not create a second row", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedDocFind.mockResolvedValue({ id: "d1" } as any);
    await onUploadCompleted({ blob: BLOB, tokenPayload: TOKEN_PAYLOAD });
    expect(mockedDocFind).toHaveBeenCalledWith({
      where: { fileUrl: BLOB.url },
      select: { id: true },
    });
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(mockedDel).not.toHaveBeenCalled();
  });

  test("target folder deleted mid-upload: filed at the matter root, callback succeeds", async () => {
    wireCompletion();
    mockedFolder.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 10 } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreate.mockResolvedValue({ id: "d1" } as any);

    await onUploadCompleted({ blob: BLOB, tokenPayload: TOKEN_PAYLOAD });

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate.mock.calls[0][0].data.folderId).toBeNull();
    const log = vi.mocked(logActivity).mock.calls[0][0];
    expect(log.detail).toMatch(/folder was deleted/);
  });

  test("folder deleted between the check and the insert (P2003): retried at the root", async () => {
    wireCompletion();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 10 } as any);
    mockedCreate
      .mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "P2003" }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce({ id: "d1" } as any);

    await onUploadCompleted({ blob: BLOB, tokenPayload: TOKEN_PAYLOAD });

    expect(mockedCreate).toHaveBeenCalledTimes(2);
    expect(mockedCreate.mock.calls[0][0].data.folderId).toBe("fold1");
    expect(mockedCreate.mock.calls[1][0].data.folderId).toBeNull();
    expect(mockedDel).not.toHaveBeenCalled();
  });

  test("matter deleted mid-upload: orphan blob removed, callback does not throw", async () => {
    wireCompletion();
    mockedMatter.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 10 } as any);
    mockedDel.mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      onUploadCompleted({ blob: BLOB, tokenPayload: TOKEN_PAYLOAD })
    ).resolves.toBeUndefined();
    errSpy.mockRestore();

    expect(mockedDel).toHaveBeenCalledWith(BLOB.url);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  test("a transient DB error still throws so Vercel retries", async () => {
    wireCompletion();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 10 } as any);
    mockedCreate.mockRejectedValue(new Error("connection reset"));
    await expect(
      onUploadCompleted({ blob: BLOB, tokenPayload: TOKEN_PAYLOAD })
    ).rejects.toThrow(/connection reset/);
    expect(mockedDel).not.toHaveBeenCalled();
  });

  test("a revalidate failure after the insert does not fail the callback", async () => {
    wireCompletion();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 10 } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreate.mockResolvedValue({ id: "d1" } as any);
    vi.mocked(revalidatePath).mockImplementation(() => {
      throw new Error("cache down");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      onUploadCompleted({ blob: BLOB, tokenPayload: TOKEN_PAYLOAD })
    ).resolves.toBeUndefined();
    errSpy.mockRestore();
    vi.mocked(revalidatePath).mockReset();
  });

  test("category from the token payload is stored; absent means discovery", async () => {
    wireCompletion();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 10 } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreate.mockResolvedValue({ id: "d1" } as any);
    await onUploadCompleted({
      blob: BLOB,
      tokenPayload: JSON.stringify({
        ...JSON.parse(TOKEN_PAYLOAD),
        category: "contract",
      }),
    });
    expect(mockedCreate.mock.calls[0][0].data.category).toBe("contract");
  });
});

describe("lead scope — onBeforeGenerateToken", () => {
  function wireLeadGates(stage = "new") {
    wireHappyGates();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedLead.mockResolvedValue({ id: "l1", stage } as any);
  }
  const LEAD_PAYLOAD = JSON.stringify({
    leadId: "l1",
    folderId: "fold1",
    name: "brief.pdf",
  });

  test("a lead target issues a token whose payload carries leadId only", async () => {
    wireLeadGates();
    const token = await onBeforeGenerateToken(KEY, LEAD_PAYLOAD, false);
    const tp = JSON.parse(token.tokenPayload as string);
    expect(tp.leadId).toBe("l1");
    expect(tp.matterId).toBeUndefined();
    expect(mockedMatter).not.toHaveBeenCalled();
    expect(mockedFolder).toHaveBeenCalledWith({
      where: { id: "fold1", leadId: "l1" },
      select: { id: true },
    });
  });

  test("both ids -> 400", async () => {
    wireLeadGates();
    const err = await tokenError(
      KEY,
      JSON.stringify({ matterId: "m1", leadId: "l1", name: "brief.pdf" })
    );
    expect(err.status).toBe(400);
  });

  test("neither id -> 400", async () => {
    wireLeadGates();
    const err = await tokenError(KEY, JSON.stringify({ name: "brief.pdf" }));
    expect(err.status).toBe(400);
  });

  test("a folder from the other scope -> 400 with the scope-neutral copy", async () => {
    wireLeadGates();
    mockedFolder.mockResolvedValue(null);
    const err = await tokenError(KEY, LEAD_PAYLOAD);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Folder not found in this matter or intake.");
  });

  test("a converted lead -> 409", async () => {
    wireLeadGates("converted");
    const err = await tokenError(KEY, LEAD_PAYLOAD);
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/already converted/);
  });

  test("an unknown lead -> 404 Lead not found.", async () => {
    wireLeadGates();
    mockedLead.mockResolvedValue(null);
    const err = await tokenError(KEY, LEAD_PAYLOAD);
    expect(err.status).toBe(404);
    expect(err.message).toBe("Lead not found.");
  });
});

describe("lead scope — onUploadCompleted", () => {
  const KEY2 = KEY;
  const BLOB2 = {
    url: `https://abc123.public.blob.vercel-storage.com/${KEY2}`,
    downloadUrl: "",
    pathname: KEY2,
    contentType: "application/pdf",
    contentDisposition: "inline",
    etag: "e1",
  };
  const LEAD_TP = JSON.stringify({
    leadId: "l1",
    folderId: "fold1",
    name: "brief.pdf",
    contentType: "application/pdf",
    userId: "u1",
  });

  function wire(stage = "new", convertedMatterId: string | null = null) {
    mockedDocFind.mockResolvedValue(null);
    // The upload runs in an interactive transaction; the mock client
    // doubles as the tx client.
    vi.mocked(prisma.$transaction).mockImplementation((async (
      fn: (tx: unknown) => unknown
    ) => fn(prisma)) as unknown as typeof prisma.$transaction);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "l1" }] as never);
    vi.mocked(canAccessMatter).mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedLead.mockResolvedValue({ id: "l1", stage, convertedMatterId } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedFolder.mockResolvedValue({ id: "fold1" } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 50 } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreate.mockResolvedValue({ id: "d1" } as any);
  }

  test("creates the row with leadId, scoped folder, and intake revalidation", async () => {
    wire();
    await onUploadCompleted({ blob: BLOB2, tokenPayload: LEAD_TP });
    const data = mockedCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.leadId).toBe("l1");
    expect(data.matterId).toBeUndefined();
    expect(data.folderId).toBe("fold1");
    expect(mockedFolder).toHaveBeenCalledWith({
      where: { id: "fold1", leadId: "l1" },
      select: { id: true },
    });
    expect(vi.mocked(logActivity).mock.calls[0][0].matterId).toBeNull();
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toContain("/intake/l1/documents");
    expect(paths).toContain("/intake/l1");
    expect(paths.some((p) => String(p).includes("null"))).toBe(false);
  });

  test("lead deleted mid-upload: orphan blob removed, no row", async () => {
    wire();
    mockedLead.mockResolvedValue(null);
    mockedDel.mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await onUploadCompleted({ blob: BLOB2, tokenPayload: LEAD_TP });
    errSpy.mockRestore();
    expect(mockedDel).toHaveBeenCalledWith(BLOB2.url);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  test("takes a FOR SHARE lock on the lead row before deciding scope", async () => {
    wire();
    await onUploadCompleted({ blob: BLOB2, tokenPayload: LEAD_TP });
    const q = vi.mocked(prisma.$queryRaw).mock.calls[0]!;
    // Tagged template: strings array + bound lead id, never interpolated.
    expect((q[0] as unknown as string[]).join("?")).toMatch(/FOR SHARE/);
    expect(q[1]).toBe("l1");
  });

  test("lead converted mid-upload: filed on the converted matter, blob kept", async () => {
    wire("converted", "m9");
    await onUploadCompleted({ blob: BLOB2, tokenPayload: LEAD_TP });
    expect(mockedDel).not.toHaveBeenCalled();
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.matterId).toBe("m9");
    expect(data.leadId).toBeUndefined();
    expect(data.folderId).toBe("fold1");
    expect(mockedFolder).toHaveBeenCalledWith({
      where: { id: "fold1", matterId: "m9" },
      select: { id: true },
    });
    expect(vi.mocked(logActivity).mock.calls[0]![0].matterId).toBe("m9");
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toContain("/matters/m9/documents");
  });

  test("converted mid-upload and the folder no longer resolves: files at the matter root", async () => {
    wire("converted", "m9");
    mockedFolder.mockResolvedValue(null);
    await onUploadCompleted({ blob: BLOB2, tokenPayload: LEAD_TP });
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.matterId).toBe("m9");
    expect(data.folderId).toBeNull();
    expect(mockedDel).not.toHaveBeenCalled();
  });

  test("converted mid-upload but uploader cannot access the matter: fail closed, blob removed", async () => {
    wire("converted", "m9");
    vi.mocked(canAccessMatter).mockResolvedValue(false);
    mockedDel.mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await onUploadCompleted({ blob: BLOB2, tokenPayload: LEAD_TP });
    errSpy.mockRestore();
    expect(canAccessMatter).toHaveBeenCalledWith("u1", "m9");
    expect(mockedDel).toHaveBeenCalledWith(BLOB2.url);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  test("lead converted with no matter recorded: blob removed, no row", async () => {
    wire("converted");
    mockedDel.mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await onUploadCompleted({ blob: BLOB2, tokenPayload: LEAD_TP });
    errSpy.mockRestore();
    expect(mockedDel).toHaveBeenCalledWith(BLOB2.url);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
