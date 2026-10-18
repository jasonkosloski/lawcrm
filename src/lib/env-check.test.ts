import { describe, expect, test, vi } from "vitest";
import { checkEnv, enforceEnv } from "./env-check";

const without = (keys: string[]) =>
  Object.fromEntries(Object.entries(fullProd).filter(([k]) => !keys.includes(k)));

const fullProd = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres://x",
  AUTH_SECRET: "s",
  BLOB_READ_WRITE_TOKEN: "t",
  CRON_SECRET: "c",
  EMAIL_TOKEN_KEY: "k",
};

describe("checkEnv", () => {
  test("off Vercel nothing is enforced (local dev, tests)", () => {
    expect(checkEnv({})).toEqual({ fatal: [], degraded: [] });
  });

  test("a complete production env passes", () => {
    expect(checkEnv(fullProd)).toEqual({ fatal: [], degraded: [] });
  });

  test("missing core vars on Vercel are fatal; blank counts as missing", () => {
    const r = checkEnv({ VERCEL: "1", VERCEL_ENV: "preview", AUTH_SECRET: "  " });
    expect(r.fatal).toEqual(["DATABASE_URL", "AUTH_SECRET", "BLOB_READ_WRITE_TOKEN"]);
    expect(r.degraded).toEqual([]);
  });

  test("cron and token keys are degraded only in production", () => {
    const rest = without(["CRON_SECRET", "EMAIL_TOKEN_KEY"]);
    expect(checkEnv(rest).degraded).toHaveLength(2);
    expect(checkEnv({ ...rest, VERCEL_ENV: "preview" }).degraded).toHaveLength(0);
  });
});

describe("enforceEnv", () => {
  test("throws naming the fatal vars", () => {
    expect(() => enforceEnv({ VERCEL: "1" })).toThrow(/DATABASE_URL/);
  });

  test("logs degraded vars without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rest = without(["CRON_SECRET"]);
    expect(() => enforceEnv(rest)).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("CRON_SECRET"));
    spy.mockRestore();
  });
});
