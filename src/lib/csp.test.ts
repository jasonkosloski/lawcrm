import { describe, expect, it } from "vitest";
import { CSP_HEADER, createNonce, fileRouteCsp, pageCsp } from "./csp";

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
});
