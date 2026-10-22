/**
 * Static guard test for the client portal: every page under
 * `src/app/(portal)` authenticates itself (ADR-028) with
 * `await requirePortalIdentity(` as its FIRST await. Only the two sign-in
 * pages are exempt; they are reachable signed out by design.
 */

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname);

const EXEMPT: ReadonlySet<string> = new Set([
  "portal/login/page.tsx",
  "portal/auth/verify/page.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^import[\s\S]*?;\s*$/gm, "");
}

const GUARD = /\bawait\s+requirePortalIdentity\s*\(/;

function check(src: string): string | null {
  const full = stripNoise(src);
  const start = full.indexOf("export default");
  const body = start === -1 ? full : full.slice(start);
  const guard = GUARD.exec(body);
  if (!guard) return "no requirePortalIdentity call";
  if (guard.index !== body.search(/\bawait\b/)) {
    return "first await is not requirePortalIdentity";
  }
  const prisma = body.indexOf("prisma.");
  if (prisma !== -1 && prisma < guard.index) return "reads prisma before the guard";
  return null;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const pages = walk(ROOT).filter((f) => path.basename(f) === "page.tsx");

describe("portal page guards", () => {
  test("the scan finds the portal pages", () => {
    const names = pages.map(rel);
    expect(names).toContain("portal/page.tsx");
    expect(names).toContain("portal/matters/[id]/page.tsx");
    expect(names).toContain("portal/login/page.tsx");
    expect(names).toContain("portal/auth/verify/page.tsx");
  });

  test.each(pages.map((f) => [rel(f), f] as const))("%s authenticates itself", (name, file) => {
    if (EXEMPT.has(name)) return;
    expect(check(readFileSync(file, "utf8")), name).toBeNull();
  });

  test("exemptions name pages that exist", () => {
    const names = new Set(pages.map(rel));
    for (const e of EXEMPT) expect(names.has(e)).toBe(true);
  });

  test("rejects a query before the guard (self-check)", () => {
    expect(
      check(
        `export default async function P() {\n  await prisma.x.findMany();\n  await requirePortalIdentity();\n}`,
      ),
    ).toBe("first await is not requirePortalIdentity");
    expect(check(`export default async function P() { await x(); }`)).toBe(
      "no requirePortalIdentity call",
    );
  });
});
