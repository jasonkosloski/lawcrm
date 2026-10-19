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
  PORTAL_HOST: "portal.example.com",
  RESEND_API_KEY: "r",
  EMAIL_FROM: "Firm <noreply@example.com>",
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

describe("portal env", () => {
  test("PORTAL_HOST/RESEND_API_KEY/EMAIL_FROM are degraded in production", () => {
    const keys = ["PORTAL_HOST", "RESEND_API_KEY", "EMAIL_FROM"];
    const rest = without(keys);
    const r = checkEnv(rest);
    expect(r.fatal).toEqual([]);
    expect(r.degraded).toHaveLength(3);
    for (const k of keys) {
      expect(r.degraded.some((d) => d.startsWith(k))).toBe(true);
    }
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
