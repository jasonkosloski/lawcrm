import { describe, expect, test, vi } from "vitest";
import { portalLinkUrl } from "./link-url";

describe("portalLinkUrl", () => {
  test("uses PORTAL_HOST over https, dev fallback otherwise", () => {
    vi.stubEnv("PORTAL_HOST", "portal.firm.test");
    expect(portalLinkUrl("abc_-")).toBe("https://portal.firm.test/auth/verify?token=abc_-");
    vi.stubEnv("PORTAL_HOST", "");
    expect(portalLinkUrl("abc")).toBe("http://portal.localhost:3000/auth/verify?token=abc");
    vi.unstubAllEnvs();
  });
});
