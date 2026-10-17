import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "./test-db-guard";

describe("assertTestDatabaseUrl", () => {
  it.each([
    "postgresql://lawcrm_test:lawcrm_test@localhost:5433/lawcrm_test",
    "postgresql://lawcrm_test:lawcrm_test@127.0.0.1:5433/lawcrm_test_b2_infra_tooling",
    "postgresql://u:p@[::1]:5434/lawcrm_test_2?schema=public",
  ])("accepts the local test database %s", (url) => {
    expect(() => assertTestDatabaseUrl(url)).not.toThrow();
  });

  it("refuses a hosted database even when the name looks like a test db", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@db.prisma.io:5432/lawcrm_test")
    ).toThrow(/not localhost/);
  });

  it("refuses a local database that is not a test database", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5432/lawcrm_dev")
    ).toThrow(/lawcrm_test/);
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5432/postgres")
    ).toThrow(/lawcrm_test/);
    // Prefix alone is not enough: "lawcrm_testing" or "lawcrm_test-prod".
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5432/lawcrm_testing")
    ).toThrow();
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5432/lawcrm_test-prod")
    ).toThrow();
  });

  it("refuses a missing or unparseable URL", () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/not set/);
    expect(() => assertTestDatabaseUrl("")).toThrow(/not set/);
    expect(() => assertTestDatabaseUrl("not a url")).toThrow(/parseable/);
  });
});
