/**
 * Portal download route: real DB + real portal session, mocked storage.
 * Pins the gate (canPortalDownload is the single check), the always-attachment
 * headers, and that every rejection is a bare 404.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const jar = new Map<string, string>();
let hostHeader = "portal.localhost:3000";
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (n: string) => (n === "host" ? hostHeader : null),
  }),
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  }),
}));
vi.mock("@/lib/file-storage", async () => {
  const { Readable } = await import("node:stream");
  return {
    isBlobKey: (k: string) => k.startsWith("https://"),
    signedBlobUrl: vi.fn(async () => "https://signed.example/file?sig=1"),
    openReadStream: vi.fn(() => Readable.from([Buffer.from("hello")])),
  };
});

import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedDocument,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { PORTAL_COOKIE } from "@/lib/portal/cookie";
import { createSession } from "@/lib/portal/sessions";
import { openReadStream, signedBlobUrl } from "@/lib/file-storage";
import { GET } from "./route";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let matterId: string;
let otherMatterId: string;
let identityId: string;

async function doc(opts: {
  matterId?: string;
  name?: string;
  contentType?: string;
  fileUrl?: string;
  share?: boolean;
}) {
  const { documentId } = await seedDocument({
    matterId: opts.matterId ?? matterId,
    name: opts.name ?? "a.pdf",
    contentType: opts.contentType ?? "application/pdf",
  });
  await prisma.document.update({
    where: { id: documentId },
    data: {
      fileUrl: opts.fileUrl ?? "abc__a.pdf",
      clientShare: opts.share === false ? "inherit" : "shared",
    },
  });
  return documentId;
}

const get = (id: string) =>
  GET(new Request(`http://portal.localhost:3000/api/documents/${id}/download`), {
    params: Promise.resolve({ id }),
  });

beforeEach(async () => {
  await resetDb();
  jar.clear();
  hostHeader = "portal.localhost:3000";
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
  ({ matterId: otherMatterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name: "Other" }));
  const { contactId } = await seedContact({ email: "jane@example.com" });
  identityId = (await prisma.portalIdentity.create({ data: { contactId, email: "jane@example.com" } })).id;
  await prisma.portalMatterAccess.create({ data: { identityId, matterId, invitedById: userId } });
  jar.set(PORTAL_COOKIE, await createSession(identityId));
});

describe("portal download route", () => {
  test("shared local file streams as an attachment, no-store", async () => {
    const id = await doc({ name: "Plea Deal é.pdf" });
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("Plea Deal é.pdf")}`
    );
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(openReadStream).toHaveBeenCalledWith("abc__a.pdf");
  });

  test("html file is still an attachment", async () => {
    const id = await doc({ name: "x.html", contentType: "text/html" });
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  test("blob file 302s to a signed download URL, no-store", async () => {
    const id = await doc({ fileUrl: "https://x.private.blob.vercel-storage.com/a.pdf" });
    const res = await get(id);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://signed.example/file?sig=1");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(signedBlobUrl).toHaveBeenCalledWith(
      "https://x.private.blob.vercel-storage.com/a.pdf",
      expect.objectContaining({ download: true })
    );
  });

  test("file on the identity's other (no-access) matter 404s", async () => {
    const id = await doc({ matterId: otherMatterId });
    const res = await get(id);
    expect(res.status).toBe(404);
    expect(openReadStream).not.toHaveBeenCalled();
  });

  test("unshared file 404s", async () => {
    expect((await get(await doc({ share: false }))).status).toBe(404);
  });

  test("revoked access 404s", async () => {
    const id = await doc({});
    await prisma.portalMatterAccess.updateMany({ data: { revokedAt: new Date() } });
    expect((await get(id)).status).toBe(404);
  });

  test("no cookie and unknown id 404", async () => {
    const id = await doc({});
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    jar.clear();
    expect((await get(id)).status).toBe(404);
  });

  test("staff host 404s even with a valid portal cookie", async () => {
    const id = await doc({});
    hostHeader = "app.example.com";
    const res = await get(id);
    expect(res.status).toBe(404);
    expect(openReadStream).not.toHaveBeenCalled();
  });

  test("404 writes no activity log", async () => {
    await get(await doc({ share: false }));
    expect(await prisma.activityLog.count()).toBe(0);
  });
});
