/**
 * Backfill: every Matter with a client must also have a
 * MatterContact(category="client") row for that client — the
 * invariant createMatter / updateMatter / convertLeadToMatter now
 * maintain. Matters converted from leads BEFORE convertLeadToMatter
 * created that row have a clientId but no party row, so their
 * Parties tab shows no client.
 *
 * Idempotent: only matters missing the row are touched, and the
 * insert is `skipDuplicates` (ON CONFLICT DO NOTHING on the
 * (matterId, contactId, category) unique), so re-running — or racing
 * a live request — can't double-insert. Run via
 * `scripts/backfill-client-matter-contacts.ts` (see
 * docs/DEPLOY_BACKFILLS.md).
 */

import type { Tx } from "@/lib/prisma";

const CHUNK = 500;

export async function backfillClientPartyRows(
  db: Pick<Tx, "matter" | "matterContact">,
  opts: { dryRun?: boolean } = {},
): Promise<{ missing: number; created: number }> {
  const withClient = await db.matter.findMany({
    where: { clientId: { not: null } },
    select: {
      id: true,
      clientId: true,
      contacts: { where: { category: "client" }, select: { contactId: true } },
    },
  });
  // Prisma can't compare two columns in a where, so the "no matching
  // (matter, clientId, client) row" test is done here.
  const missing = withClient.filter((m) => !m.contacts.some((c) => c.contactId === m.clientId));
  if (opts.dryRun) return { missing: missing.length, created: 0 };

  let created = 0;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const res = await db.matterContact.createMany({
      data: missing.slice(i, i + CHUNK).map((m) => ({
        matterId: m.id,
        contactId: m.clientId as string,
        category: "client",
      })),
      skipDuplicates: true,
    });
    created += res.count;
  }
  return { missing: missing.length, created };
}
