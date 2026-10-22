/**
 * The document_invoice_id migration's backfill: links already-filed invoice
 * PDFs (named "Invoice <number> (...") in a matter's Invoices system folder
 * to their invoice. The UPDATE is read out of the migration file.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const dir = readdirSync(migrationsDir).find((d) => d.endsWith("_document_invoice_id"));
const sql = readFileSync(path.join(migrationsDir, dir!, "migration.sql"), "utf8");
const backfill = sql.slice(sql.indexOf('UPDATE "documents"')).trim().replace(/;$/, "");

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
  expect(backfill.startsWith("UPDATE")).toBe(true);
});

const day = new Date("2026-10-21T00:00:00.000Z");
let userId: string;
let areaIds: { areaId: string; stageId: string };

async function matter() {
  const { matterId } = await seedMatter({
    practiceAreaId: areaIds.areaId,
    stageId: areaIds.stageId,
    leadUserId: userId,
  });
  return matterId;
}
const invoice = (matterId: string, invoiceNumber: string) =>
  prisma.invoice.create({ data: { invoiceNumber, matterId, issueDate: day, dueDate: day } });
const folder = (matterId: string, systemKind: string | null) =>
  prisma.documentFolder.create({ data: { matterId, name: "F", systemKind } });
const doc = (matterId: string, folderId: string, name: string) =>
  prisma.document.create({ data: { matterId, folderId, name } });
const linked = async (id: string) =>
  (await prisma.document.findUniqueOrThrow({ where: { id } })).invoiceId;

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  areaIds = await seedPracticeArea();
});

describe("document invoiceId backfill", () => {
  test("links by name in the invoices folder of the same matter only", async () => {
    const m1 = await matter();
    const m2 = await matter();
    const inv = await invoice(m1, "2026-101");
    await invoice(m1, "2026-1010");
    const inv1010 = await prisma.invoice.findUniqueOrThrow({
      where: { invoiceNumber: "2026-1010" },
    });
    const f1 = await folder(m1, "invoices");
    const fPlain = await folder(m1, null);
    const f2 = await folder(m2, "invoices");

    const hit = await doc(m1, f1.id, "Invoice 2026-101 (sent 2026-10-21).pdf");
    const hit1010 = await doc(m1, f1.id, "Invoice 2026-1010 (sent 2026-10-21).pdf");
    const nonSystem = await doc(m1, fPlain.id, "Invoice 2026-101 (sent 2026-10-21).pdf");
    const otherMatter = await doc(m2, f2.id, "Invoice 2026-101 (sent 2026-10-21).pdf");
    const unrelated = await doc(m1, f1.id, "Invoice 2026-101.pdf");

    // "_" and "%" in a number are literal, not LIKE wildcards.
    const invU = await invoice(m1, "2026_1");
    const hitU = await doc(m1, f1.id, "Invoice 2026_1 (sent 2026-10-21).pdf");
    const wildcard = await doc(m1, f1.id, "Invoice 2026X1 (sent 2026-10-21).pdf");

    await prisma.$executeRawUnsafe(backfill);

    expect(await linked(hitU.id)).toBe(invU.id);
    expect(await linked(wildcard.id)).toBeNull();
    expect(await linked(hit.id)).toBe(inv.id);
    expect(await linked(hit1010.id)).toBe(inv1010.id);
    expect(await linked(nonSystem.id)).toBeNull();
    expect(await linked(otherMatter.id)).toBeNull();
    expect(await linked(unrelated.id)).toBeNull();

    // Idempotent: a second run changes nothing.
    await prisma.$executeRawUnsafe(backfill);
    expect(await linked(hit.id)).toBe(inv.id);
  });
});
