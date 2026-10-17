/**
 * Static guard test: every exported server action that touches a
 * matter (or a record reached through a matter-scoped child id) must
 * call a matter-access helper before it writes, on top of its
 * permission key. See src/lib/matter-access.ts and ADR-039.
 *
 * Source scan, no execution. For each exported async function in a
 * non-test file under src/app/actions we extract the body (brace
 * matching, comments stripped) and, when the body mentions a matter
 * or child-record identifier, require a call to one of the access
 * helpers. Genuine exceptions go in ALLOWLIST with a reason.
 */

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname);

/** Identifiers that mean "this action is scoped to a matter". */
const SCOPE_IDENT =
  /\b(?:matterId|matter_id|noteId|documentId|folderId|parentFolderId|timeEntryId|expenseId|invoiceId|deadlineId|taskId|eventId|momentId|flaggedMomentId|partyId|settlementId|lienId|evidenceId|threadId|paymentId|trustTransactionId|approvalId)\b/;
const SCOPE_FORM_KEY = /\bget\(\s*["'`](?:matterId|matter_id|matter)["'`]\s*\)/;

const ACCESS_CALL =
  /\b(?:assertMatterAccess|assertOptionalMatterAccess|assertChildMatterAccess|assertMatterAccessResult|assertAnyMatterAccess|assertMattersAccess)\s*\(/;

/**
 * "file.ts:functionName" -> reason. Keep tiny; every entry needs a
 * real reason.
 */
const ALLOWLIST: Record<string, string> = {
  "matters.ts:createMatter":
    "Creates a brand-new matter (nothing exists to be walled off); the creator is added to its team.",
  "leads.ts:convertLeadToMatter":
    "Always creates a NEW matter from a lead; it never attaches to an existing one.",
  "contacts.ts:mergeContacts":
    "Firm-wide contact directory operation (contacts.merge); re-points party rows across matters by contact id, not a matter-scoped write.",
  "email-send.ts:sendEmail":
    "Composes a NEW unfiled thread on the sender's own mailbox; takes no matter input. (replyToThread asserts the thread's matter.)",
  "email-thread-flags.ts:toggleEmailThreadStar":
    "Mailbox-personal flag on the caller's OWN thread (owner-scoped query); writes no matter data.",
  "email-thread-flags.ts:setEmailThreadStarred":
    "Mailbox-personal flag on the caller's OWN thread (owner-scoped query); writes no matter data.",
  "email-thread-flags.ts:setEmailThreadArchived":
    "Mailbox-personal flag on the caller's OWN thread (owner-scoped query); writes no matter data.",
  "follow-ups.ts:setEmailThreadFollowUp":
    "Personal reminder on the caller's OWN thread; matterId is only read to revalidate paths.",
  "thread-read.ts:markEmailThreadRead":
    "Per-user read marker on the caller's OWN thread; writes no matter data.",
};

export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

export type ExportedFn = { name: string; body: string };

/** Extract `export async function name(...) { body }` by brace matching. */
export function exportedAsyncFunctions(src: string): ExportedFn[] {
  const clean = stripComments(src);
  const out: ExportedFn[] = [];
  const re = /export\s+async\s+function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    // skip the parameter list (balanced parens), then find the body "{"
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < clean.length && depth > 0) {
      if (clean[i] === "(") depth++;
      else if (clean[i] === ")") depth--;
      i++;
    }
    // Return type annotation may contain braces inside generics
    // (Promise<{ ok: boolean }>); the body is the first "{" outside <>.
    let j = i;
    let angle = 0;
    for (; j < clean.length; j++) {
      const c = clean[j];
      if (c === "<") angle++;
      else if (c === ">" && clean[j - 1] !== "=") angle--;
      else if (c === "{" && angle <= 0) break;
    }
    let d = 1;
    let k = j + 1;
    while (k < clean.length && d > 0) {
      if (clean[k] === "{") d++;
      else if (clean[k] === "}") d--;
      k++;
    }
    // Signature included: a `matterId` parameter counts as scoped.
    out.push({ name: m[1], body: clean.slice(m.index, k) });
  }
  return out;
}

/** Returns a problem string, or null when fine / out of scope. */
export function checkFunction(fn: ExportedFn): string | null {
  // `matterId: null` is a firm-scope activity-log row, not a matter write.
  const body = fn.body.replace(/\bmatterId\s*:\s*null\b/g, "");
  const scoped = SCOPE_IDENT.test(body) || SCOPE_FORM_KEY.test(body);
  if (!scoped) return null;
  if (ACCESS_CALL.test(fn.body)) return null;
  return "references a matter/child id but never calls a matter-access helper";
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

const cases = files.flatMap((f) =>
  exportedAsyncFunctions(readFileSync(path.join(DIR, f), "utf8")).map(
    (fn) => [`${f}:${fn.name}`, fn] as const
  )
);

describe("matter-access guards on server actions", () => {
  test("the scan finds the actions it is supposed to guard", () => {
    expect(cases.length).toBeGreaterThan(150);
    const names = cases.map(([n]) => n);
    expect(names).toContain("notes.ts:createNote");
    expect(names).toContain("time-entries.ts:createTimeEntry");
  });

  test.each(cases)("%s", (name, fn) => {
    if (ALLOWLIST[name]) return;
    expect(checkFunction(fn), name).toBeNull();
  });

  test("the allowlist only names functions that exist", () => {
    const names = new Set<string>(cases.map(([n]) => n));
    for (const entry of Object.keys(ALLOWLIST)) {
      expect(names.has(entry), entry).toBe(true);
    }
  });
});

describe("scanner self-checks", () => {
  test("extracts bodies with nested braces and return types", () => {
    const src = `
export async function a(x: string): Promise<{ ok: boolean }> {
  if (x) { return { ok: true }; }
  return { ok: false };
}
export async function b() { return 1; }
`;
    const fns = exportedAsyncFunctions(src);
    expect(fns.map((f) => f.name)).toEqual(["a", "b"]);
    expect(fns[0].body).toContain("ok: false");
    expect(fns[0].body).not.toContain("return 1");
    expect(fns[1].body).toContain("return 1");
  });

  test("flags a matter-scoped action with no assert", () => {
    const [fn] = exportedAsyncFunctions(
      `export async function f(fd: FormData) { const matterId = fd.get("matterId"); await prisma.note.create({}); }`
    );
    expect(checkFunction(fn)).not.toBeNull();
  });

  test("a call in a comment does not satisfy the scan", () => {
    const [fn] = exportedAsyncFunctions(
      `export async function f(matterId: string) {\n // await assertMatterAccess(matterId);\n await prisma.note.create({});\n}`
    );
    expect(checkFunction(fn)).not.toBeNull();
  });

  test("accepts each helper", () => {
    for (const call of [
      "assertMatterAccess(matterId)",
      "assertOptionalMatterAccess(matterId)",
      "assertChildMatterAccess('note', noteId)",
    ]) {
      const [fn] = exportedAsyncFunctions(
        `export async function f(matterId: string, noteId: string) { await ${call}; }`
      );
      expect(checkFunction(fn)).toBeNull();
    }
  });

  test("ignores functions with no matter or child ids", () => {
    const [fn] = exportedAsyncFunctions(
      `export async function f(name: string) { await prisma.tag.create({}); }`
    );
    expect(checkFunction(fn)).toBeNull();
  });
});
