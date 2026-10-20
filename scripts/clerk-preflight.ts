/**
 * Read-only pre-flight for the production Clerk cutover.
 *
 *   npm run clerk:preflight   (tsx --conditions=react-server: see prisma.ts)
 *
 * Reads DATABASE_URL (from .env or the environment). Prints the host
 * and the first 6 chars of the DB user it connected to (never the
 * password), then the active users whose email is not on the firm's
 * Google domain and how many are already linked to Clerk. Writes
 * nothing.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  describeDatabaseUrl,
  formatPreflight,
  summarizePreflight,
} from "../src/lib/clerk-preflight";

async function main() {
  const db = describeDatabaseUrl(process.env.DATABASE_URL);
  // Print the target BEFORE querying so a wrong DB is obvious.
  console.log(`Connecting to ${db.host} (user "${db.userPrefix}...")`);
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { email: true, name: true, clerkUserId: true },
      orderBy: { email: "asc" },
    });
    console.log(formatPreflight(db, summarizePreflight(users)));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
