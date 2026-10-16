// @vitest-environment node

/**
 * next.config.ts security headers (F261/F392/F927/F442).
 *
 * Pins the baseline response headers and the one deliberate exception:
 * the same-origin file routes the document viewer iframes must be
 * SAMEORIGIN. The rules are asserted NON-OVERLAPPING with Next's own
 * path matcher (each path hits exactly one rule), so the result does not
 * depend on how Next/Vercel merge repeated header keys.
 */

import { describe, expect, it } from "vitest";
// @ts-expect-error -- Next's compiled path-to-regexp ships no type declarations
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import nextConfig, { FRAMEABLE_FILE_ROUTES } from "../next.config";

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<Rule[]> {
  return (await nextConfig.headers!()) as Rule[];
}

/** Rules whose source matches `path`, using Next's own path matcher. */
function matching(all: Rule[], path: string): Rule[] {
  return all.filter((r) => pathToRegexp(r.source).test(path));
}

const FRAMED = [
  "/api/documents/abc123/download",
  "/api/email-attachments/xyz/download",
];
const NOT_FRAMED = [
  "/",
  "/matters/abc",
  "/api/documents/abc123/download/extra",
  "/api/documents/abc123/downloadx",
  "/api/documents/a/b/download",
  "/api/documents/upload",
  "/api/email-attachments/xyz/other",
];

function header(rule: Rule, key: string): string | undefined {
  return rule.headers.find((h) => h.key === key)?.value;
}

describe("next.config headers()", () => {
  it("applies the baseline security headers to every non-framed path", async () => {
    const all = await rules();
    for (const path of NOT_FRAMED) {
      const hits = matching(all, path);
      expect(hits, path).toHaveLength(1);
      const rule = hits[0];
      expect(header(rule, "X-Frame-Options"), path).toBe("DENY");
      expect(header(rule, "X-Content-Type-Options")).toBe("nosniff");
      expect(header(rule, "Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin"
      );
      const permissions = header(rule, "Permissions-Policy") ?? "";
      for (const feature of ["camera", "microphone", "geolocation"]) {
        expect(permissions).toContain(`${feature}=()`);
      }
    }
  });

  it("gives only the viewer-framed file routes SAMEORIGIN, via exactly one matching rule", async () => {
    const all = await rules();
    expect(FRAMEABLE_FILE_ROUTES).toEqual([
      "/api/documents/:id/download",
      "/api/email-attachments/:id/download",
    ]);
    for (const path of [...FRAMED, ...FRAMED.map((p) => `${p}/`)]) {
      // No overlap: the outcome never depends on rule-merge order.
      const hits = matching(all, path);
      expect(hits, path).toHaveLength(1);
      expect(header(hits[0], "X-Frame-Options"), path).toBe("SAMEORIGIN");
      // everything else from the baseline still applies
      expect(header(hits[0], "X-Content-Type-Options")).toBe("nosniff");
      expect(header(hits[0], "Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin"
      );
    }
  });

  it("does not ship a CSP that could collide with the download routes' sandbox CSP", async () => {
    const all = await rules();
    for (const rule of all) {
      expect(rule.headers.map((h) => h.key.toLowerCase())).not.toContain(
        "content-security-policy"
      );
    }
  });

  it("hides the framework banner", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
