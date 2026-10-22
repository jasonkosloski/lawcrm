import { describe, expect, it } from "vitest";
import { CSP_HEADER, clerkFrontendApiOrigin, createNonce, fileRouteCsp, pageCsp } from "./csp";

describe("csp", () => {
  it("is report-only until the rollout flips it", () => {
    expect(CSP_HEADER).toBe("Content-Security-Policy-Report-Only");
  });

  it("page policy: nonce + strict-dynamic, no unsafe-inline scripts, eval only in dev", () => {
    const prod = pageCsp("abc", { isDev: false });
    expect(prod).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(prod).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).toContain("style-src 'self' 'nonce-abc'");
    expect(pageCsp("abc", { isDev: true })).toContain("'unsafe-eval'");
  });

  it("file-route policy allows same-origin framing only", () => {
    expect(fileRouteCsp()).toContain("frame-ancestors 'self'");
  });

  it("nonces are unique", () => {
    expect(createNonce()).not.toBe(createNonce());
  });

  describe("Clerk", () => {
    const KEY = "pk_test_" + btoa("foo-bar-1.clerk.accounts.dev$");
    const directive = (csp: string, name: string) =>
      csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

    it("decodes the frontend API origin from the publishable key", () => {
      expect(clerkFrontendApiOrigin(KEY)).toBe("https://foo-bar-1.clerk.accounts.dev");
      expect(clerkFrontendApiOrigin("pk_live_" + btoa("clerk.example.com$"))).toBe(
        "https://clerk.example.com",
      );
    });

    it("returns null for missing or malformed keys", () => {
      expect(clerkFrontendApiOrigin(undefined)).toBeNull();
      expect(clerkFrontendApiOrigin("")).toBeNull();
      expect(clerkFrontendApiOrigin("sk_test_abc")).toBeNull();
      expect(clerkFrontendApiOrigin("pk_test_!!!")).toBeNull();
      expect(clerkFrontendApiOrigin("pk_test_" + btoa("no-dollar"))).toBeNull();
    });

    it("pageCsp allows Clerk script/connect/frame sources when a key is set", () => {
      const csp = pageCsp("abc", { isDev: false, clerkPublishableKey: KEY });
      const origin = "https://foo-bar-1.clerk.accounts.dev";
      expect(directive(csp, "script-src")).toContain(origin);
      expect(directive(csp, "connect-src")).toContain(origin);
      expect(directive(csp, "script-src")).toContain("https://challenges.cloudflare.com");
      expect(directive(csp, "script-src")).toContain("https://*.protect.clerk.com");
      expect(directive(csp, "frame-src")).toContain("https://challenges.cloudflare.com");
      expect(directive(csp, "frame-src")).toContain("https://*.protect.clerk.com");
      expect(directive(csp, "connect-src")).toContain("https://*.protect.clerk.com");
    });

    it("pageCsp is unchanged without a usable key", () => {
      const csp = pageCsp("abc", { isDev: false });
      expect(csp).not.toContain("clerk");
      expect(csp).not.toContain("cloudflare");
      expect(pageCsp("abc", { isDev: false, clerkPublishableKey: "junk" })).toBe(csp);
    });
  });
});
