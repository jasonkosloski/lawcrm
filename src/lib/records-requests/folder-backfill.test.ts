/**
 * The generated-folders migration backfill, run against real Postgres.
 * The test DB is built with `db push`, so the SQL between the BACKFILL
 * markers is extracted from the migration and executed here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { linkRecordsFoldersUnder } from "@/lib/records-requests/folder";
import {
  resetDb,
  seedContact,
  seedDocument,
  seedDocumentFolder,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const sql = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20261018200000_generated_folders/migration.sql"),
  "utf8",
);
const body = sql.slice(
  sql.indexOf("-- BACKFILL BEGIN") + "-- BACKFILL BEGIN".length,
  sql.indexOf("-- BACKFILL END"),
);
const statements = body
  .split(";\n")
  .map((s) => s.trim())
  .filter((s) => s.replace(/--.*$/gm, "").trim().length > 0);

async function runBackfill() {
  for (const s of statements) await prisma.$executeRawUnsafe(s);
}

let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId, name: "Atty" });
  const { areaId, stageId } = await seedPracticeArea();
  matterId = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId })).matterId;
});

async function kinds() {
  const rows = await prisma.documentFolder.findMany({
    select: { id: true, systemKind: true, recordsRequestId: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

describe("generated folders backfill", () => {
  test("extracts three statements", () => {
    expect(statements).toHaveLength(3);
  });

  test("succeeds on an empty database", async () => {
    await expect(runBackfill()).resolves.toBeUndefined();
  });

  test("marks legacy folders, leaves the rest, and is idempotent", async () => {
    const { contactId } = await seedContact({ name: "Memorial Hospital" });
    const mk = (adHocTypeName: string, createdAt?: Date) =>
      prisma.recordsRequest.create({
        data: {
          matterId,
          custodianContactId: contactId,
          adHocTypeName,
          subject: "s",
          ...(createdAt ? { createdAt } : {}),
        },
        select: { id: true },
      });
    const r1 = await mk("CORA");
    const r2 = await mk("Other", new Date("2030-01-01"));

    const inv = (await seedDocumentFolder({ matterId, name: "Investigation" })).folderId;
    const root = (await seedDocumentFolder({ matterId, name: "Records Requests", parentId: inv }))
      .folderId;
    const req = (
      await seedDocumentFolder({ matterId, name: "Memorial Hospital — CORA", parentId: root })
    ).folderId;
    const reqDocs = (
      await seedDocumentFolder({ matterId, name: "Request documents", parentId: req })
    ).folderId;
    const respDocs = (
      await seedDocumentFolder({ matterId, name: "Responsive documents", parentId: req })
    ).folderId;
    const untagged = (
      await seedDocumentFolder({ matterId, name: "Empty Co — CORA", parentId: root })
    ).folderId;
    const strayRoot = (await seedDocumentFolder({ matterId, name: "Records Requests" })).folderId;

    // One doc for r1 directly in the request folder... plus a tie-break
    // check: r2 has one doc in a subfolder, so r1 (2 docs) wins.
    for (const [folderId, rid] of [
      [req, r1.id],
      [reqDocs, r1.id],
      [respDocs, r2.id],
    ] as const) {
      const { documentId } = await seedDocument({ matterId, folderId });
      await prisma.document.update({
        where: { id: documentId },
        data: { recordsRequestId: rid },
      });
    }

    await runBackfill();
    const first = await kinds();
    expect(first.get(inv)).toMatchObject({ systemKind: null, recordsRequestId: null });
    expect(first.get(root)).toMatchObject({ systemKind: "records_root", recordsRequestId: null });
    expect(first.get(req)).toMatchObject({
      systemKind: "records_request",
      recordsRequestId: r1.id,
    });
    expect(first.get(reqDocs)).toMatchObject({
      systemKind: "records_request_docs",
      recordsRequestId: r1.id,
    });
    expect(first.get(respDocs)).toMatchObject({
      systemKind: "records_responsive_docs",
      recordsRequestId: r1.id,
    });
    expect(first.get(untagged)).toMatchObject({ systemKind: null, recordsRequestId: null });
    expect(first.get(strayRoot)).toMatchObject({ systemKind: null, recordsRequestId: null });

    await runBackfill();
    expect(await kinds()).toEqual(first);
  });

  describe("equal document counts", () => {
    async function seedTie() {
      const { contactId } = await seedContact({ name: "Memorial Hospital" });
      const mk = (adHocTypeName: string, createdAt: Date) =>
        prisma.recordsRequest.create({
          data: {
            matterId,
            custodianContactId: contactId,
            adHocTypeName,
            subject: "s",
            createdAt,
          },
          select: { id: true },
        });
      // Created late first so insertion order can't decide the winner.
      const late = await mk("Late", new Date("2030-01-01"));
      const early = await mk("Early", new Date("2020-01-01"));
      const inv = (await seedDocumentFolder({ matterId, name: "Investigation" })).folderId;
      const root = (await seedDocumentFolder({ matterId, name: "Records Requests", parentId: inv }))
        .folderId;
      const req = (await seedDocumentFolder({ matterId, name: "Shared", parentId: root })).folderId;
      const sub = (await seedDocumentFolder({ matterId, name: "Request documents", parentId: req }))
        .folderId;
      for (const [folderId, rid] of [
        [req, late.id],
        [sub, early.id],
      ] as const) {
        const { documentId } = await seedDocument({ matterId, folderId });
        await prisma.document.update({
          where: { id: documentId },
          data: { recordsRequestId: rid },
        });
      }
      return { early, req, sub, root };
    }

    test("SQL backfill: a 1-vs-1 tie goes to the earliest request", async () => {
      const { early, req, sub } = await seedTie();
      await runBackfill();
      const k = await kinds();
      expect(k.get(req)).toMatchObject({
        systemKind: "records_request",
        recordsRequestId: early.id,
      });
      expect(k.get(sub)).toMatchObject({ recordsRequestId: early.id });
    });

    test("linkRecordsFoldersUnder: a 1-vs-1 tie goes to the earliest request", async () => {
      const { early, req, sub, root } = await seedTie();
      await prisma.$transaction((tx) => linkRecordsFoldersUnder(tx, { matterId }, root));
      const k = await kinds();
      expect(k.get(req)).toMatchObject({
        systemKind: "records_request",
        recordsRequestId: early.id,
      });
      expect(k.get(sub)).toMatchObject({ recordsRequestId: early.id });
    });
  });
});
