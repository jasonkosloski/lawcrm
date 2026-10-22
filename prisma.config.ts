// Prisma config. Connection URLs live here (Prisma 7 moved them
// out of the schema). Runtime queries use DATABASE_URL via the
// PrismaPg adapter; CLI tools (`prisma migrate`, `prisma db push`)
// use the same URL by default and DIRECT_DATABASE_URL only if you
// explicitly need a separate non-pooled URL for migrations.
import "dotenv/config";
import { defineConfig } from "prisma/config";
import { checkDestructiveDbAllowed, isDestructivePrismaInvocation } from "./src/lib/seed-guard";

// This file loads for EVERY Prisma CLI command, including the
// `migrate deploy` the operator runs against production on purpose,
// so only the data-destroying invocations are guarded: `migrate reset`
// (drops the database, then runs the seed) and `db seed`. Without
// this, a stale production DATABASE_URL in the shell or .env.local
// plus `npm run db:reset` wipes the database before the seed's own
// guard (prisma/seed.ts) ever runs.
if (isDestructivePrismaInvocation(process.argv)) {
  const guard = checkDestructiveDbAllowed(process.env);
  if (!guard.ok) {
    throw new Error(`[prisma.config] ${guard.reason}`);
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"],
  },
});
