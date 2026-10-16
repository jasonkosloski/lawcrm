/**
 * Static guard test: every page (and every non-trivial layout) under
 * `src/app/(dashboard)` and `src/app/print` must authenticate itself.
 *
 * Why: the proxy only checks that a session COOKIE is present (any
 * value), and Next renders a page without re-running its parent
 * layouts on partial (RSC) requests — the client-supplied router
 * state decides which layouts execute. A layout is therefore not an
 * auth gate; each `page.tsx` must call a session guard itself, before
 * it reads data. (See node_modules/next/dist/docs authentication
 * guide, "Layouts and auth checks".)
 *
 * Accepted guards (all redirect on failure and are React-cache()d,
 * so repeat calls are free): `requireUser`, `requirePermission`,
 * `requireAdmin`, `getCurrentUserId`. `currentUserHasPermission` is
 * deliberately NOT accepted — it is a read-side flag, and pages that
 * only use it should add `requireUser()` as their first statement.
 *
 * This is a source scan (no rendering). In the default export's body
 * it asserts (1) the FIRST `await` is a guard call — so no query
 * helper (`getLeadById`, `listLeads`, ...) or `Promise.all` batch can
 * run before authentication — and (2) no `prisma.` access precedes the guard.
 */

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const APP_DIR = path.resolve(__dirname);
const ROOTS = [path.join(APP_DIR, "(dashboard)"), path.join(APP_DIR, "print")];

const GUARD_CALL = /\b(?:requireUser|requirePermission|requireAdmin|getCurrentUserId)\s*\(/;
/** A guard call that is the operand of an `await`. */
const AWAITED_GUARD =
  /\bawait\s+(?:requireUser|requirePermission|requireAdmin|getCurrentUserId)\s*\(/;

/**
 * Pages that genuinely have no guard TODAY and are owned by another
 * work package. Each entry is a path relative to `src/app`. Remove
 * the entry in the same change that adds the guard. Entries that
 * already have a guard are tolerated (so parallel work does not
 * break this test), but they should be deleted.
 */
// Every page guards itself; keep this empty. A page may only be added
// here with a comment explaining why it needs no session at all.
const PAGE_ALLOWLIST: ReadonlySet<string> = new Set([]);

/**
 * Layouts that legitimately carry no `requireUser`-style guard:
 *   - (dashboard)/layout.tsx is the UX gate itself (calls `auth()`
 *     and redirects; pages still guard themselves).
 *   - print/layout.tsx renders a bare wrapper and reads no data.
 */
const LAYOUT_ALLOWLIST: ReadonlySet<string> = new Set([
  "(dashboard)/layout.tsx",
  "print/layout.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Drop block + line comments so a guard mentioned in prose (or an
 *  import line) can't satisfy the scan. */
function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^import[\s\S]*?;\s*$/gm, "");
}

function rel(file: string): string {
  return path.relative(APP_DIR, file).split(path.sep).join("/");
}

const allFiles = ROOTS.flatMap((r) => walk(r));
const pages = allFiles.filter((f) => path.basename(f) === "page.tsx");
const layouts = allFiles.filter((f) => path.basename(f) === "layout.tsx");

/** Pure check on source text; exported shape kept simple so the
 *  self-checks below can run it against fixtures. */
function checkSource(src: string): string | null {
  const full = stripNoise(src);
  // Helpers above the default export may use prisma; only the
  // default export's own body is ordered against the guard.
  const start = full.indexOf("export default");
  const body = start === -1 ? full : full.slice(start);
  if (!GUARD_CALL.test(body)) return "no session guard call";
  const firstAwait = body.search(/\bawait\b/);
  const guard = AWAITED_GUARD.exec(body);
  if (!guard || guard.index !== firstAwait) {
    return "first await is not a session guard";
  }
  const firstPrisma = body.indexOf("prisma.");
  if (firstPrisma !== -1 && firstPrisma < guard.index) {
    return "reads prisma before the session guard";
  }
  return null;
}

function checkGuarded(file: string): string | null {
  return checkSource(readFileSync(file, "utf8"));
}

describe("page auth guards", () => {
  test("the scan finds the pages it is supposed to guard", () => {
    // Sanity: a path-handling bug would silently pass an empty set.
    expect(pages.length).toBeGreaterThan(30);
    expect(pages.map(rel)).toContain("print/invoices/[id]/page.tsx");
    expect(pages.map(rel)).toContain("(dashboard)/intake/page.tsx");
  });

  test.each(pages.map((f) => [rel(f), f] as const))(
    "%s authenticates itself",
    (name, file) => {
      if (PAGE_ALLOWLIST.has(name)) return;
      expect(checkGuarded(file), name).toBeNull();
    }
  );

  test("the allowlist only names pages that exist", () => {
    const names = new Set(pages.map(rel));
    for (const entry of PAGE_ALLOWLIST) expect(names.has(entry)).toBe(true);
  });

  test("the guard scan rejects an unguarded page (self-check)", () => {
    const body = stripNoise(
      `import { requireUser } from "@/lib/current-user";\n` +
        `// requireUser() mentioned only in a comment\n` +
        `export default async function P() { return prisma.lead.findMany(); }`
    );
    expect(GUARD_CALL.test(body)).toBe(false);
  });

  test("checkSource accepts a page whose first await is the guard", () => {
    expect(
      checkSource(
        `export default async function P() {\n` +
          `  await requireUser();\n  const l = await getLeadById("x");\n}`
      )
    ).toBeNull();
    expect(
      checkSource(
        `export default async function P() {\n` +
          `  await requirePermission("leads.view");\n  await prisma.lead.findMany();\n}`
      )
    ).toBeNull();
  });

  test("checkSource rejects a query helper awaited before the guard", () => {
    expect(
      checkSource(
        `export default async function P() {\n` +
          `  const lead = await getLeadById("x");\n  await requireUser();\n}`
      )
    ).toBe("first await is not a session guard");
  });

  test("checkSource rejects a guard batched into Promise.all with data reads", () => {
    expect(
      checkSource(
        `export default async function P() {\n` +
          `  const [uid, leads] = await Promise.all([getCurrentUserId(), listLeads()]);\n}`
      )
    ).toBe("first await is not a session guard");
  });

  test("checkSource rejects a params await before the guard", () => {
    expect(
      checkSource(
        `export default async function P({ params }) {\n` +
          `  const { id } = await params;\n  await requireUser();\n}`
      )
    ).toBe("first await is not a session guard");
  });

  test("checkSource rejects a page with no guard call at all", () => {
    expect(
      checkSource(`export default async function P() { await listLeads(); }`)
    ).toBe("no session guard call");
  });
});

describe("layout auth guards", () => {
  test.each(layouts.map((f) => [rel(f), f] as const))(
    "%s authenticates itself",
    (name, file) => {
      if (LAYOUT_ALLOWLIST.has(name)) return;
      expect(checkGuarded(file), name).toBeNull();
    }
  );
});
