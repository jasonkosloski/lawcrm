import { afterEach, describe, expect, test, vi } from "vitest";
import { isDevPortalHost } from "./host";

describe("isDevPortalHost", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("portal.localhost (any port, trailing dot, any case) outside production", () => {
    for (const h of ["portal.localhost", "portal.localhost:3000", "Portal.Localhost.:3000"]) {
      expect(isDevPortalHost(h)).toBe(true);
    }
  });

  test("never in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevPortalHost("portal.localhost:3000")).toBe(false);
  });

  test("never the configured PORTAL_HOST or any other host", () => {
    vi.stubEnv("PORTAL_HOST", "portal.example.com");
    for (const h of [null, "", "portal.example.com", "localhost:3000", "evil.portal.localhost"]) {
      expect(isDevPortalHost(h)).toBe(false);
    }
  });
});
