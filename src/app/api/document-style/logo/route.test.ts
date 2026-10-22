// @vitest-environment node
/**
 * Route tests for /api/document-style/logo. Handlers are called
 * directly with Request objects; auth and storage are mocked, the DB
 * and sharp are real.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import sharp from "sharp";

vi.mock("@/lib/staff-auth", () => ({ getStaffAuthFromRequest: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({ userHasPermission: vi.fn() }));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/file-storage", () => ({
  storeFile: vi.fn(),
  readStoredFile: vi.fn(),
  deleteFile: vi.fn(),
}));

import { getStaffAuthFromRequest } from "@/lib/staff-auth";
import { userHasPermission } from "@/lib/permission-check";
import { getCurrentFirm } from "@/lib/firm";
import { deleteFile, readStoredFile, storeFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import { getDocumentStyle } from "@/lib/templates/document-style";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import { DELETE, GET, POST } from "./route";

const URL_ = "http://localhost/api/document-style/logo";
let firmId: string;
let userId: string;
let keyCounter = 0;

const pngOf = (w = 20, h = 10) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#336699" } })
    .png()
    .toBuffer();
const jpegOf = () =>
  sharp({ create: { width: 20, height: 10, channels: 3, background: "#996633" } })
    .jpeg()
    .toBuffer();

function upload(bytes: Uint8Array, name = "logo.png", withLength = true): Request {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], name));
  const size = bytes.length + 512;
  const body = new Response(fd);
  return new Request(URL_, {
    method: "POST",
    body: body.body,
    headers: {
      "content-type": body.headers.get("content-type")!,
      ...(withLength ? { "content-length": String(size) } : {}),
    },
    duplex: "half",
  } as RequestInit);
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.resetAllMocks();
  keyCounter = 0;
  ({ firmId } = await seedFirm());
  userId = (await seedUser({ firmId, name: "Attorney" })).userId;
  vi.mocked(getCurrentFirm).mockResolvedValue({ id: firmId } as never);
  vi.mocked(getStaffAuthFromRequest).mockResolvedValue({
    status: "ok",
    userId,
    clerkUserId: "c",
    sessionId: "s",
  });
  vi.mocked(userHasPermission).mockResolvedValue(true);
  vi.mocked(storeFile).mockImplementation(async () => {
    keyCounter += 1;
    return { key: `logo-${keyCounter}` } as never;
  });
  vi.mocked(deleteFile).mockResolvedValue(undefined);
});

describe("POST", () => {
  test("401 signed out, 403 without the permission; nothing stored", async () => {
    vi.mocked(getStaffAuthFromRequest).mockResolvedValueOnce({ status: "signed_out" });
    expect((await POST(upload(await pngOf()))).status).toBe(401);
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const r = await POST(upload(await pngOf()));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ ok: false });
    expect(userHasPermission).toHaveBeenCalledWith(userId, "firm.edit_document_style");
    expect(storeFile).not.toHaveBeenCalled();
  });

  test("stores a PNG, sets position left from none, logs", async () => {
    const r = await POST(upload(await pngOf()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, logoPosition: "left" });
    const row = await getDocumentStyle();
    expect(row.logoKey).toBe("logo-1");
    expect(row.logoContentType).toBe("image/png");
    expect(row.logoPosition).toBe("left");
    const file = vi.mocked(storeFile).mock.calls[0][0];
    expect(file.type).toBe("image/png");
    expect(await prisma.activityLog.count({ where: { source: "Settings" } })).toBe(1);
  });

  test("keeps an existing position", async () => {
    const row = await getDocumentStyle();
    await prisma.documentStyle.update({ where: { id: row.id }, data: { logoPosition: "right" } });
    await POST(upload(await pngOf()));
    expect((await getDocumentStyle()).logoPosition).toBe("right");
  });

  test("a .png name with JPEG bytes is accepted and re-encoded to a real PNG", async () => {
    const r = await POST(upload(await jpegOf(), "logo.png"));
    expect(r.status).toBe(200);
    const stored = vi.mocked(storeFile).mock.calls[0][0];
    const out = new Uint8Array(await stored.arrayBuffer());
    expect(Array.from(out.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect((await sharp(out).metadata()).format).toBe("png");
  });

  test("caps the longest side at 1200 px, never enlarges", async () => {
    await POST(upload(await pngOf(2400, 600)));
    const big = new Uint8Array(await vi.mocked(storeFile).mock.calls[0][0].arrayBuffer());
    const m = await sharp(big).metadata();
    expect([m.width, m.height]).toEqual([1200, 300]);
    await POST(upload(await pngOf(20, 10)));
    const small = new Uint8Array(await vi.mocked(storeFile).mock.calls[1][0].arrayBuffer());
    expect((await sharp(small).metadata()).width).toBe(20);
  });

  test("refuses a GIF by magic bytes, whatever the name", async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b]);
    const r = await POST(upload(gif, "logo.png"));
    expect(r.status).toBe(400);
    expect(storeFile).not.toHaveBeenCalled();
  });

  test("refuses undecodable PNG-signature bytes with 400", async () => {
    const bad = new Uint8Array(64);
    bad.set([0x89, 0x50, 0x4e, 0x47]);
    const r = await POST(upload(bad));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, error: "That image couldn't be read." });
    expect(storeFile).not.toHaveBeenCalled();
  });

  test("1 MB accepted by the size gate, 1 MB + 1 byte refused with 413", async () => {
    const over = new Uint8Array(1024 * 1024 + 1);
    over.set([0x89, 0x50, 0x4e, 0x47]);
    expect((await POST(upload(over))).status).toBe(413);
    const exactly = new Uint8Array(1024 * 1024);
    exactly.set([0x89, 0x50, 0x4e, 0x47]);
    // Passes the size gate; fails later as undecodable (400, not 413).
    expect((await POST(upload(exactly))).status).toBe(400);
    expect(storeFile).not.toHaveBeenCalled();
  });

  test("missing file field is a 400", async () => {
    const fd = new FormData();
    fd.set("other", "x");
    const r = await POST(
      new Request(URL_, { method: "POST", body: fd, headers: { "content-length": "100" } }),
    );
    expect(r.status).toBe(400);
  });

  test("411 without Content-Length, before reading the body", async () => {
    const r = await POST(upload(await pngOf(), "logo.png", false));
    expect(r.status).toBe(411);
    expect(await r.json()).toEqual({ ok: false, error: "Upload size unknown." });
    expect(storeFile).not.toHaveBeenCalled();
  });

  test("a PNG claiming huge dimensions is a 400, not a hang", async () => {
    const png = new Uint8Array(await pngOf());
    const dv = new DataView(png.buffer, png.byteOffset);
    dv.setUint32(16, 60000);
    dv.setUint32(20, 60000);
    const r = await POST(upload(png));
    expect(r.status).toBe(400);
    expect(storeFile).not.toHaveBeenCalled();
  });

  test("returns the new updatedAt and position so the form can keep saving", async () => {
    const r = await POST(upload(await pngOf()));
    const row = await getDocumentStyle();
    expect(await r.json()).toEqual({
      ok: true,
      updatedAt: row.updatedAt.toISOString(),
      logoPosition: "left",
    });
  });

  test("409 and the new file is deleted when the logo changed underneath", async () => {
    await POST(upload(await pngOf()));
    const row = await getDocumentStyle();
    const orig = prisma.documentStyle.updateMany.bind(prisma.documentStyle);
    const spy = vi.spyOn(prisma.documentStyle, "updateMany").mockImplementationOnce(((
      args: never,
    ) => {
      return prisma.documentStyle
        .update({ where: { id: row.id }, data: { logoKey: "other" } })
        .then(() => orig(args));
    }) as never);
    const r = await POST(upload(await pngOf()));
    spy.mockRestore();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, error: "The logo changed — try again." });
    expect(deleteFile).toHaveBeenCalledWith("logo-2");
    expect((await getDocumentStyle()).logoKey).toBe("other");
  });

  test("replacing deletes the old key after the row update", async () => {
    await POST(upload(await pngOf()));
    await POST(upload(await pngOf()));
    expect((await getDocumentStyle()).logoKey).toBe("logo-2");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("logo-1");
  });

  test("a failed row update deletes the new file and keeps the old one", async () => {
    await POST(upload(await pngOf()));
    const spy = vi
      .spyOn(prisma.documentStyle, "updateMany")
      .mockRejectedValueOnce(new Error("db down"));
    await expect(POST(upload(await pngOf()))).rejects.toThrow("db down");
    spy.mockRestore();
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("logo-2");
    expect((await getDocumentStyle()).logoKey).toBe("logo-1");
  });
});

describe("DELETE", () => {
  test("403 without the permission", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await DELETE(new Request(URL_, { method: "DELETE" }))).status).toBe(403);
  });

  test("clears the row and deletes the file", async () => {
    await POST(upload(await pngOf()));
    const r = await DELETE(new Request(URL_, { method: "DELETE" }));
    const row = await getDocumentStyle();
    expect(await r.json()).toEqual({
      ok: true,
      updatedAt: row.updatedAt.toISOString(),
      logoPosition: "left",
    });
    expect(row.logoKey).toBeNull();
    expect(row.logoContentType).toBeNull();
    expect(deleteFile).toHaveBeenCalledWith("logo-1");
  });

  test("409 when the logo changed underneath", async () => {
    await POST(upload(await pngOf()));
    const row = await getDocumentStyle();
    const orig = prisma.documentStyle.updateMany.bind(prisma.documentStyle);
    const spy = vi.spyOn(prisma.documentStyle, "updateMany").mockImplementationOnce(((
      args: never,
    ) => {
      return prisma.documentStyle
        .update({ where: { id: row.id }, data: { logoKey: "other" } })
        .then(() => orig(args));
    }) as never);
    const r = await DELETE(new Request(URL_, { method: "DELETE" }));
    spy.mockRestore();
    expect(r.status).toBe(409);
    expect((await getDocumentStyle()).logoKey).toBe("other");
  });

  test("ok when there is no logo", async () => {
    const r = await DELETE(new Request(URL_, { method: "DELETE" }));
    expect(r.status).toBe(200);
    expect(deleteFile).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  test("401 when signed out", async () => {
    vi.mocked(getStaffAuthFromRequest).mockResolvedValueOnce({ status: "signed_out" });
    expect((await GET(new Request(URL_))).status).toBe(401);
  });

  test("404 when there is no logo", async () => {
    expect((await GET(new Request(URL_))).status).toBe(404);
  });

  test("404 when the file is gone", async () => {
    await POST(upload(await pngOf()));
    vi.mocked(readStoredFile).mockResolvedValue(null);
    expect((await GET(new Request(URL_))).status).toBe(404);
  });

  test("streams the PNG with no-store caching; needs no edit permission", async () => {
    await POST(upload(await pngOf()));
    const bytes = await pngOf();
    vi.mocked(readStoredFile).mockResolvedValue(bytes);
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const r = await GET(new Request(URL_));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await r.arrayBuffer()).equals(bytes)).toBe(true);
    expect(readStoredFile).toHaveBeenCalledWith("logo-1", 1024 * 1024 + 1);
  });
});
