/**
 * Safety rail for the integration-test harness.
 *
 * `resetDb()` issues `DELETE FROM` on every table and globalSetup runs
 * `prisma db push --accept-data-loss`, so both must only ever touch a
 * disposable local test database. Pure and dependency-free so the
 * globalSetup (which runs before DATABASE_URL exists), the DB helpers
 * and the unit tests can all import it.
 *
 * Rule: the host must be localhost / 127.0.0.1 / ::1 and the database
 * name must start with `lawcrm_test` (`lawcrm_test`, or a per-worktree
 * copy such as `lawcrm_test_b2_infra_tooling`). The port is not pinned
 * so a parameterised docker-compose port keeps working.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TEST_DB_NAME_RE = /^lawcrm_test(?:_[A-Za-z0-9_]+)?$/;

export function assertTestDatabaseUrl(
  url: string | undefined,
  label = "DATABASE_URL"
): void {
  if (!url) {
    throw new Error(`${label} is not set; refusing to run destructive test helpers.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} is not a parseable URL; refusing to run destructive test helpers.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `${label} points at host "${host}", not localhost; refusing to wipe a non-local database.`
    );
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!TEST_DB_NAME_RE.test(dbName)) {
    throw new Error(
      `${label} points at database "${dbName}"; destructive test helpers only run against databases named lawcrm_test*.`
    );
  }
}
