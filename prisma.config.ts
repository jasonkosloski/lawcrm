// Prisma config. Connection URLs live here (Prisma 7 moved them
// out of the schema). Runtime queries use DATABASE_URL via the
// PrismaPg adapter; CLI tools (`prisma migrate`, `prisma db push`)
// use the same URL by default and DIRECT_DATABASE_URL only if you
// explicitly need a non-pooled URL for migrations (Vercel Postgres
// pgbouncer mode).
import "dotenv/config";
import { defineConfig } from "prisma/config";

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
