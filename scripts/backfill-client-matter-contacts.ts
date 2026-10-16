/**
 * One-off, idempotent backfill: give every matter that has a client
 * the matching MatterContact(category="client") party row.
 *
 *   npx tsx scripts/backfill-client-matter-contacts.ts --dry-run
 *   npx tsx scripts/backfill-client-matter-contacts.ts
 *
 * Reads DATABASE_URL (from .env or the environment). Safe to re-run.
 * See docs/DEPLOY_BACKFILLS.md.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { backfillClientPartyRows } from "../src/lib/backfill-client-party-rows";

async function main() {
  try {
    const dryRun = process.argv.includes("--dry-run");
    const { missing, created } = await backfillClientPartyRows(prisma, {
      dryRun,
    });
    console.log(
      dryRun
        ? `[dry run] ${missing} matter(s) missing a client party row.`
        : `${missing} matter(s) missing a client party row; ${created} row(s) created.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
