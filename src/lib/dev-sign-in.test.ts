import { describe, expect, it } from "vitest";
import { isDevSignInAllowed } from "./dev-sign-in";

const TEST = "pk_test_abc";
describe("isDevSignInAllowed", () => {
  it("allows dev with a test key", () => {
    expect(
      isDevSignInAllowed({ NODE_ENV: "development", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: TEST })
    ).toBe(true);
    expect(
      isDevSignInAllowed({ NODE_ENV: "test", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: TEST })
    ).toBe(true);
  });
  it("refuses production even with a test key", () => {
    expect(
      isDevSignInAllowed({ NODE_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: TEST })
    ).toBe(false);
  });
  it("refuses a live key in dev", () => {
    expect(
      isDevSignInAllowed({ NODE_ENV: "development", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_abc" })
    ).toBe(false);
  });
  it("refuses a missing or empty key", () => {
    expect(isDevSignInAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(
      isDevSignInAllowed({ NODE_ENV: "development", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "" })
    ).toBe(false);
  });
  it("refuses when VERCEL is set", () => {
    expect(
      isDevSignInAllowed({ NODE_ENV: "development", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: TEST, VERCEL: "1" })
    ).toBe(false);
  });
});
