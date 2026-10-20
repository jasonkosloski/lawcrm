import { afterEach, describe, expect, it, vi } from "vitest";
import { staffAuthorizedParties } from "./staff-authorized-parties";

afterEach(() => vi.unstubAllEnvs());

describe("staffAuthorizedParties", () => {
  it("production: the deployment's own origins only, never localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.example.com");
    vi.stubEnv("VERCEL_URL", "lawcrm-abc.vercel.app");
    vi.stubEnv("AUTH_URL", "");
    expect(staffAuthorizedParties()).toEqual([
      "https://app.example.com",
      "https://lawcrm-abc.vercel.app",
    ]);
  });

  it("includes AUTH_URL's origin when set, deduped", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.example.com");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("AUTH_URL", "https://app.example.com/");
    expect(staffAuthorizedParties()).toEqual(["https://app.example.com"]);
  });

  it("development adds localhost:3000", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("AUTH_URL", "");
    expect(staffAuthorizedParties()).toEqual(["http://localhost:3000"]);
  });

  it("ignores a malformed AUTH_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.example.com");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("AUTH_URL", "not a url");
    expect(staffAuthorizedParties()).toEqual(["https://app.example.com"]);
  });

  it("production with nothing configured returns undefined (no azp check)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("AUTH_URL", "");
    expect(staffAuthorizedParties()).toBeUndefined();
  });
});
