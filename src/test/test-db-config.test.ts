import { describe, expect, it } from "vitest";
import {
  baseTestDbUrl,
  dbNameOf,
  maintenanceDbUrl,
  resolveMaxWorkers,
  workerDbUrl,
} from "./test-db-config";
import { assertTestDatabaseUrl } from "./test-db-guard";

const BASE = "postgresql://u:p@localhost:5433/lawcrm_test";

describe("test-db-config", () => {
  it("derives per-worker URLs that still pass the guard", () => {
    const url = workerDbUrl(BASE, 3);
    expect(dbNameOf(url)).toBe("lawcrm_test_w3");
    expect(() => assertTestDatabaseUrl(url)).not.toThrow();
    expect(new URL(url).port).toBe("5433");
  });

  it("points the maintenance URL at postgres", () => {
    expect(dbNameOf(maintenanceDbUrl(BASE))).toBe("postgres");
  });

  it("honours TEST_DATABASE_URL", () => {
    expect(baseTestDbUrl({ TEST_DATABASE_URL: BASE })).toBe(BASE);
    expect(baseTestDbUrl({})).toMatch(/lawcrm_test$/);
  });

  it("sizes workers: half the cores, capped at 4, env override", () => {
    expect(resolveMaxWorkers({}, 16)).toBe(4);
    expect(resolveMaxWorkers({}, 8)).toBe(4);
    expect(resolveMaxWorkers({}, 4)).toBe(2);
    expect(resolveMaxWorkers({}, 1)).toBe(1);
    expect(resolveMaxWorkers({ TEST_MAX_WORKERS: "6" }, 2)).toBe(6);
    expect(resolveMaxWorkers({ TEST_MAX_WORKERS: "0" }, 8)).toBe(4);
    expect(resolveMaxWorkers({ TEST_MAX_WORKERS: "x" }, 8)).toBe(4);
  });
});
