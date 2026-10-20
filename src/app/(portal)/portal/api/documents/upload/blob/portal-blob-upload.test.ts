/**
 * Portal client-direct blob upload: token gates, the signed callback URL,
 * and completion. Real test DB; the portal session and the Blob SDK's
 * network calls are mocked.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/portal-access", () => ({ getPortalIdentity: vi.fn() }));
vi.mock("@/lib/file-storage", () => ({ deleteFile: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return { ...actual, del: vi.fn(async () => {}), head: vi.fn() };
});

import { NextRequest, type NextFetchEvent } from "next/server";
import { BlobNotFoundError, del, head } from "@vercel/blob";
import { getPayloadFromClientToken, handleUpload } from "@vercel/blob/client";
import { getPortalIdentity } from "@/lib/portal-access";
import { deleteFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import { proxy } from "@/proxy";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
} from "@/app/api/documents/upload/upload-config";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import {
  PORTAL_UPLOAD_CALLBACK_PATH,
  PortalUploadError,
  onBeforeGenerateToken,
  onUploadCompleted,
  portalUploadCallbackUrl,
} from "./portal-blob-upload";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

const KEY = "AAAAAAAAAAAAAAAA__lease.pdf";
const BATCH = "11111111-1111-4111-8111-111111111111";
const BLOB_URL = `https://store.public.blob.vercel-storage.com/${KEY}`;

let userId: string;
let matterId: string;
let otherMatterId: string;
let identityId: string;

function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({ matterId, batchId: BATCH, name: "lease.pdf", ...over });
}

async function tokenError(pathname: string, clientPayload: string | null) {
  const err = await onBeforeGenerateToken(pathname, clientPayload, false).then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(PortalUploadError);
  return err as PortalUploadError;
}

async function request(status: string, matter = matterId) {
  return (
    await prisma.documentRequest.create({
      data: { matterId: matter, title: "Lease", status, createdById: userId },
    })
  ).id;
}

beforeEach(async () => {
  vi.stubEnv("PORTAL_HOST", "portal.example.com");
  await resetDb();
  const { firmId } = await seedFirm();
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  ({ userId } = await seedUser({ firmId }));
  const { stageId, areaId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
  ({ matterId: otherMatterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name: "Other" }));
  const { contactId } = await seedContact({ name: "Pat Client", email: "pat@example.com" });
  identityId = (await prisma.portalIdentity.create({ data: { contactId, email: "pat@example.com" } })).id;
  await prisma.portalMatterAccess.create({ data: { identityId, matterId, invitedById: userId } });
  vi.mocked(getPortalIdentity).mockResolvedValue({ identityId, contactId, email: "pat@example.com" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(getPortalIdentity).mockReset();
  vi.mocked(head).mockReset();
  vi.mocked(del).mockClear();
  vi.mocked(deleteFile).mockClear();
});

describe("onBeforeGenerateToken: gates", () => {
  test("no portal identity -> 401", async () => {
    vi.mocked(getPortalIdentity).mockResolvedValue(null);
    expect((await tokenError(KEY, payload())).status).toBe(401);
  });

  test("a pathname outside the key scheme -> 400", async () => {
    expect((await tokenError("../x/lease.pdf", payload())).status).toBe(400);
  });

  test("malformed payload or a non-uuid batch -> 400", async () => {
    expect((await tokenError(KEY, "not json")).status).toBe(400);
    expect((await tokenError(KEY, payload({ batchId: "x" }))).status).toBe(400);
  });

  test("a matter without live access -> 404", async () => {
    expect((await tokenError(KEY, payload({ matterId: otherMatterId }))).status).toBe(404);
    await prisma.portalMatterAccess.updateMany({ data: { revokedAt: new Date() } });
    expect((await tokenError(KEY, payload())).status).toBe(404);
  });

  test("a request on another matter -> 404", async () => {
    const requestId = await request("open", otherMatterId);
    expect((await tokenError(KEY, payload({ requestId }))).status).toBe(404);
  });

  test("a cancelled request -> 409 with plain copy", async () => {
    const requestId = await request("cancelled");
    const err = await tokenError(KEY, payload({ requestId }));
    expect(err.status).toBe(409);
    expect(err.message).toBe("This request was closed by the firm.");
  });

  test("a request this batch answered and staff sent back since -> 409", async () => {
    const requestId = await request("open");
    await prisma.document.create({
      data: {
        matterId,
        name: "first.pdf",
        source: "portal",
        portalUploaderId: identityId,
        portalBatchId: BATCH,
        documentRequestId: requestId,
      },
    });
    await prisma.documentRequest.update({ where: { id: requestId }, data: { returnNote: "Wrong year" } });
    expect((await tokenError(KEY, payload({ requestId }))).status).toBe(409);
    // A new batch may resubmit it.
    await expect(
      onBeforeGenerateToken(KEY, payload({ requestId, batchId: "33333333-3333-4333-8333-333333333333" }), false)
    ).resolves.toBeTruthy();
  });

  test("a disallowed type -> 400 with the rejection copy", async () => {
    const err = await tokenError("AAAAAAAAAAAAAAAA__archive.zip", payload({ name: "archive.zip" }));
    expect(err.status).toBe(400);
    expect(err.message).toBe(
      "We can't accept .zip files. Please send PDFs, photos or Office documents."
    );
  });

  test("a display name whose type differs from the key -> 400", async () => {
    expect((await tokenError(KEY, payload({ name: "lease.exe" }))).status).toBe(400);
  });

  test("the 101st upload in 24 h -> 429 with the limit copy", async () => {
    await prisma.document.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        matterId,
        name: `f${i}.pdf`,
        source: "portal",
        portalUploaderId: identityId,
      })),
    });
    const err = await tokenError(KEY, payload());
    expect(err.status).toBe(429);
    expect(err.message).toBe("You've reached today's upload limit. Please try again tomorrow.");
  });

  test("uploads older than 24 h do not count toward the limit", async () => {
    await prisma.document.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        matterId,
        name: `f${i}.pdf`,
        source: "portal",
        portalUploaderId: identityId,
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      })),
    });
    await expect(onBeforeGenerateToken(KEY, payload(), false)).resolves.toBeTruthy();
  });

  test("no PORTAL_HOST: refuses rather than guessing a callback URL", async () => {
    vi.stubEnv("PORTAL_HOST", "");
    expect((await tokenError(KEY, payload())).status).toBe(503);
  });
});

describe("onBeforeGenerateToken: token contract", () => {
  test("pins type, size and overwrite; the payload carries the SESSION identity", async () => {
    const requestId = await request("open");
    const r = await onBeforeGenerateToken(
      KEY,
      payload({ requestId, note: "  signed copy ", identityId: "attacker" }),
      false
    );
    expect(r).toMatchObject({
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: MAX_STANDARD_UPLOAD_BYTES,
      addRandomSuffix: false,
      allowOverwrite: false,
      callbackUrl: "https://portal.example.com/api/documents/upload/blob",
    });
    expect(JSON.parse(r.tokenPayload!)).toEqual({
      kind: "portal",
      identityId,
      matterId,
      requestId,
      batchId: BATCH,
      name: "lease.pdf",
      note: "signed copy",
      contentType: "application/pdf",
    });
  });

  test("media gets the media cap", async () => {
    const r = await onBeforeGenerateToken(
      "AAAAAAAAAAAAAAAA__clip.mov",
      payload({ name: "clip.MOV" }),
      false
    );
    expect(r.allowedContentTypes).toEqual(["video/quicktime"]);
    expect(r.maximumSizeInBytes).toBe(MAX_MEDIA_UPLOAD_BYTES);
  });
});

describe("callback URL (the completion webhook must reach the PUBLIC portal path)", () => {
  test("portalUploadCallbackUrl targets the portal host, never /portal/...", () => {
    expect(PORTAL_UPLOAD_CALLBACK_PATH).toBe("/api/documents/upload/blob");
    expect(portalUploadCallbackUrl()).toBe("https://portal.example.com/api/documents/upload/blob");
  });

  test("handleUpload signs that URL even though the handler runs at the rewritten internal path", async () => {
    // On Vercel the SDK's default would be VERCEL_PROJECT_PRODUCTION_URL
    // (the staff host) + the request path; both are wrong here.
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store123_secretsecretsecret");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.example.com");
    const internal = new Request(
      "https://portal.example.com/portal/api/documents/upload/blob",
      { method: "POST" }
    );
    const res = await handleUpload({
      body: {
        type: "blob.generate-client-token",
        payload: { pathname: KEY, clientPayload: payload(), multipart: false },
      },
      request: internal,
      onBeforeGenerateToken,
      onUploadCompleted,
    });
    if (res.type !== "blob.generate-client-token") throw new Error(res.type);
    const signed = getPayloadFromClientToken(res.clientToken) as {
      onUploadCompleted?: { callbackUrl: string };
    };
    expect(signed.onUploadCompleted?.callbackUrl).toBe(
      "https://portal.example.com/api/documents/upload/blob"
    );
  });

  test("the proxy rewrites that public path into this route on the portal host", async () => {
    const req = new NextRequest(new URL(PORTAL_UPLOAD_CALLBACK_PATH, "https://portal.example.com"), {
      method: "POST",
      headers: { host: "portal.example.com" },
    });
    const res = (await proxy(req, {} as NextFetchEvent)) as Response;
    expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe(
      "/portal/api/documents/upload/blob"
    );
  });
});

describe("onUploadCompleted (signed webhook: no portal cookie)", () => {
  async function signedPayload(over: Record<string, unknown> = {}) {
    const r = await onBeforeGenerateToken(KEY, payload(over), false);
    return r.tokenPayload!;
  }

  function complete(tokenPayload: string | null) {
    return onUploadCompleted({
      blob: {
        url: BLOB_URL,
        downloadUrl: BLOB_URL,
        pathname: KEY,
        contentType: "application/pdf",
        contentDisposition: "",
        etag: "e",
      },
      tokenPayload,
    } as Parameters<typeof onUploadCompleted>[0]);
  }

  test("creates the row from the signed payload, without consulting the session", async () => {
    const requestId = await request("open");
    const tp = await signedPayload({ requestId, note: "lease" });
    vi.mocked(getPortalIdentity).mockReset();
    vi.mocked(head).mockResolvedValue({ size: 2048 } as Awaited<ReturnType<typeof head>>);
    await complete(tp);
    expect(getPortalIdentity).not.toHaveBeenCalled();
    const doc = await prisma.document.findFirstOrThrow({ where: { fileUrl: BLOB_URL } });
    expect(doc).toMatchObject({
      matterId,
      portalUploaderId: identityId,
      documentRequestId: requestId,
      source: "portal",
      uploadedBy: null,
      fileSize: 2048,
      contentType: "application/pdf",
      name: "lease.pdf",
      portalBatchId: BATCH,
    });
    expect((await prisma.documentRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("submitted");
  });

  test("access revoked mid-upload: no row, blob deleted, callback succeeds", async () => {
    const tp = await signedPayload();
    await prisma.portalMatterAccess.updateMany({ data: { revokedAt: new Date() } });
    vi.mocked(head).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof head>>);
    await expect(complete(tp)).resolves.toBeUndefined();
    expect(await prisma.document.count()).toBe(0);
    expect(deleteFile).toHaveBeenCalledWith(BLOB_URL);
  });

  test("portal switched off mid-upload: no row, blob deleted", async () => {
    const tp = await signedPayload();
    await prisma.firm.updateMany({ data: { portalEnabled: false } });
    vi.mocked(head).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof head>>);
    await complete(tp);
    expect(await prisma.document.count()).toBe(0);
    expect(deleteFile).toHaveBeenCalledWith(BLOB_URL);
  });

  test("redelivery creates no duplicate", async () => {
    const tp = await signedPayload();
    vi.mocked(head).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof head>>);
    await complete(tp);
    await complete(tp);
    expect(await prisma.document.count()).toBe(1);
    expect(await prisma.notification.count({ where: { type: "portal_upload" } })).toBe(1);
  });

  test("an empty blob is deleted and gets no row", async () => {
    const tp = await signedPayload();
    vi.mocked(head).mockResolvedValue({ size: 0 } as Awaited<ReturnType<typeof head>>);
    await complete(tp);
    expect(await prisma.document.count()).toBe(0);
    expect(del).toHaveBeenCalledWith(BLOB_URL);
  });

  test("a missing, malformed or staff-shaped payload throws (never guesses identity)", async () => {
    vi.mocked(head).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof head>>);
    await expect(complete(null)).rejects.toThrow();
    await expect(complete("{")).rejects.toThrow();
    await expect(
      complete(JSON.stringify({ matterId, folderId: null, name: "x.pdf", userId, contentType: "application/pdf" }))
    ).rejects.toThrow();
    expect(await prisma.document.count()).toBe(0);
  });

  test("redelivery after the blob was refused and deleted: head 404 -> clean return", async () => {
    const tp = await signedPayload();
    vi.mocked(head).mockRejectedValue(new BlobNotFoundError());
    await expect(complete(tp)).resolves.toBeUndefined();
    expect(await prisma.document.count()).toBe(0);
  });

  test("other head() failures still throw so Vercel retries", async () => {
    const tp = await signedPayload();
    vi.mocked(head).mockRejectedValue(new Error("network"));
    await expect(complete(tp)).rejects.toThrow("network");
  });

  test("a blob key with a disallowed type is deleted, no row", async () => {
    const tp = await signedPayload();
    vi.mocked(head).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof head>>);
    await onUploadCompleted({
      blob: {
        url: "https://store.public.blob.vercel-storage.com/AAAAAAAAAAAAAAAA__x.exe",
        downloadUrl: "",
        pathname: "AAAAAAAAAAAAAAAA__x.exe",
        contentType: "application/octet-stream",
        contentDisposition: "",
        etag: "e",
      },
      tokenPayload: tp,
    } as Parameters<typeof onUploadCompleted>[0]);
    expect(await prisma.document.count()).toBe(0);
    expect(del).toHaveBeenCalledWith("https://store.public.blob.vercel-storage.com/AAAAAAAAAAAAAAAA__x.exe");
  });

  test("a disallowed type in a payload is refused at completion too", async () => {
    const tp = JSON.parse(await signedPayload());
    vi.mocked(head).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof head>>);
    await complete(JSON.stringify({ ...tp, name: "x.exe" }));
    expect(await prisma.document.count()).toBe(0);
    expect(deleteFile).toHaveBeenCalledWith(BLOB_URL);
  });
});
