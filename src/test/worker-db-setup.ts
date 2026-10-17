/**
 * Vitest `setupFiles` entry (first in the list): point this worker at
 * its own database BEFORE any test file imports `@/lib/prisma`, which
 * reads DATABASE_URL when first loaded. `integration-setup.ts` created
 * `<base>_w<N>` for every pool id. See `test-db-config.ts`.
 */

import { assertTestDatabaseUrl } from "./test-db-guard";
import { baseTestDbUrl, workerDbUrl } from "./test-db-config";

const poolId = Number(process.env.VITEST_POOL_ID);
if (Number.isInteger(poolId) && poolId >= 1) {
  const url = workerDbUrl(baseTestDbUrl(), poolId);
  assertTestDatabaseUrl(url, "worker DATABASE_URL");
  process.env.DATABASE_URL = url;
  process.env.DIRECT_DATABASE_URL = url;
}
