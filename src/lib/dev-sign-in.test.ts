import { describe, expect, it } from "vitest";
import { isDevSignInAllowed } from "./dev-sign-in";

const TEST = "pk_test_abc";
const LOCAL = "postgresql://u:p@localhost:5433/db";
const base = {
  DEV_SIGN_IN: "1",
  DATABASE_URL: LOCAL,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: TEST,
};
describe("isDevSignInAllowed", () => {
  it("allows dev with a test key", () => {
    expect(
      isDevSignInAllowed({ ...base, NODE_ENV: "development" })
    ).toBe(true);
    expect(
      isDevSignInAllowed({ ...base, NODE_ENV: "test" })
    ).toBe(true);
  });
  it("refuses production even with a test key", () => {
    expect(
      isDevSignInAllowed({ ...base, NODE_ENV: "production" })
    ).toBe(false);
  });
  it("refuses a live key in dev", () => {
    expect(
      isDevSignInAllowed({ ...base, NODE_ENV: "development", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_abc" })
    ).toBe(false);
  });
  it("refuses a missing or empty key", () => {
    expect(isDevSignInAllowed({ ...base, NODE_ENV: "development", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: undefined })).toBe(false);
    expect(
      isDevSignInAllowed({ ...base, NODE_ENV: "development", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "" })
    ).toBe(false);
  });
  it("refuses when VERCEL is set", () => {
    expect(
      isDevSignInAllowed({ ...base, NODE_ENV: "development", VERCEL: "1" })
    ).toBe(false);
  });
  it("requires the explicit DEV_SIGN_IN=1 opt-in", () => {
    expect(isDevSignInAllowed({ ...base, NODE_ENV: "development" })).toBe(true);
    expect(
      isDevSignInAllowed({ ...base, NODE_ENV: "development", DEV_SIGN_IN: undefined })
    ).toBe(false);
    expect(
      isDevSignInAllowed({ ...base, NODE_ENV: "development", DEV_SIGN_IN: "0" })
    ).toBe(false);
  });
  it("refuses a non-local database", () => {
    expect(
      isDevSignInAllowed({
        ...base,
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://u:p@db.prod.example.com/x",
      })
    ).toBe(false);
  });
  it("honours ALLOW_SEED=1 for a known remote dev database", () => {
    expect(
      isDevSignInAllowed({
        ...base,
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://u:p@db.dev.example.com/x",
        ALLOW_SEED: "1",
      })
    ).toBe(true);
  });
  it("refuses when no database is configured", () => {
    expect(
      isDevSignInAllowed({ ...base, NODE_ENV: "development", DATABASE_URL: undefined })
    ).toBe(false);
  });
});
