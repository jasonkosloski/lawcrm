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
  /\b(?:assertMatterAccess|assertOptionalMatterAccess|assertRecordAccess|assertChildMatterAccess|assertMatterAccessResult|assertAnyMatterAccess|assertMattersAccess|assertScopeAccess)\s*\(/;

/**
 * "file.ts:functionName" -> reason. Keep tiny; every entry needs a
 * real reason.
 */
const ALLOWLIST: Record<string, string> = {
  "matters.ts:createMatter":
    "Creates a brand-new matter (nothing exists to be walled off); the creator is added to its team.",
  "leads.ts:convertLeadToMatter":
    "Always creates a NEW matter from a lead; it never attaches to an existing one.",
  "notes.ts:createLeadNote":
    "Writes a lead-scoped note (no matter). It reads taskId / deadlineId / etc. only to refuse them, and a reply's parent must be on the same lead.",
  "captures.ts:createLeadTask":
    "Creates a task on an intake lead (no matter); `matterId: null` is the only matter reference.",
  "captures.ts:createLeadEvent":
    "Creates an event on an intake lead (no matter, creator-only attendees); `matterId: null` is the only matter reference.",
  "contacts.ts:mergeContacts":
    "Firm-wide contact directory operation (contacts.merge); re-points party rows across matters by contact id, not a matter-scoped write.",
  "email-filing.ts:setEmailThreadRecord":
    "Delegates to fileEmailThread (src/lib/email-filing.ts), which asserts scope access on the thread's current record and on the target; runtime-tested in email-filing.test.ts.",
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
  "portal-messages-client.ts:sendPortalMessage":
    "Portal-client action, not staff: gated by the portal identity's live PortalMatterAccess (livePortalMatterWhere), not staff matter access.",
  "portal-messages-client.ts:markPortalMessagesRead":
    "Portal-client action, not staff: gated by the portal identity's live PortalMatterAccess (livePortalMatterWhere), not staff matter access.",
  "thread-read.ts:markEmailThreadRead":
    "Per-user read marker on the caller's OWN thread; writes no matter data.",
};

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
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
    (fn) => [`${f}:${fn.name}`, fn] as const,
  ),
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
      `export async function f(fd: FormData) { const matterId = fd.get("matterId"); await prisma.note.create({}); }`,
    );
    expect(checkFunction(fn)).not.toBeNull();
  });

  test("a call in a comment does not satisfy the scan", () => {
    const [fn] = exportedAsyncFunctions(
      `export async function f(matterId: string) {\n // await assertMatterAccess(matterId);\n await prisma.note.create({});\n}`,
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
        `export async function f(matterId: string, noteId: string) { await ${call}; }`,
      );
      expect(checkFunction(fn)).toBeNull();
    }
  });

  test("ignores functions with no matter or child ids", () => {
    const [fn] = exportedAsyncFunctions(
      `export async function f(name: string) { await prisma.tag.create({}); }`,
    );
    expect(checkFunction(fn)).toBeNull();
  });
});

// ── Lead wall (restricted intake, ADR-049) ──────────────────────────────
//
// An action that references a `leadId` must call a LEAD-AWARE helper:
// `assertLeadAccess`, `assertScopeAccess` (lead branch) or
// `assertChildMatterAccess` (routes lead children to the lead wall).
// `assertOptionalMatterAccess` / `assertMatterAccess` do not count.

const LEAD_IDENT = /\bleadId\b/;
const LEAD_ACCESS_CALL =
  /\b(?:assertLeadAccess|assertScopeAccess|assertChildMatterAccess|assertRecordAccess)\s*\(/;

/** "file.ts:functionName" -> reason. */
const LEAD_ALLOWLIST: Record<string, string> = {
  "email-filing.ts:setEmailThreadRecord":
    "Delegates to fileEmailThread (src/lib/email-filing.ts), which asserts scope access on the thread's current record and on the target; runtime-tested in email-filing.test.ts.",
  "leads.ts:createLead":
    "Creates a brand-new, unrestricted lead; `leadId` is only the new row's id on its activity entry.",
};

export function checkLeadFunction(fn: ExportedFn): string | null {
  // `leadId: null` is a matter-only write, not a lead reference.
  const body = fn.body.replace(/\bleadId\s*:\s*null\b/g, "");
  if (!LEAD_IDENT.test(body)) return null;
  if (LEAD_ACCESS_CALL.test(fn.body)) return null;
  return "references a leadId but never calls a lead-aware access helper";
}

describe("lead-access guards on server actions", () => {
  test("the scan sees the lead actions", () => {
    const names = cases.map(([n]) => n);
    expect(names).toContain("leads.ts:convertLeadToMatter");
    expect(names).toContain("notes.ts:createLeadNote");
  });

  test.each(cases)("%s", (name, fn) => {
    if (LEAD_ALLOWLIST[name]) return;
    expect(checkLeadFunction(fn), name).toBeNull();
  });

  test("the allowlist only names functions that exist", () => {
    const names = new Set<string>(cases.map(([n]) => n));
    for (const entry of Object.keys(LEAD_ALLOWLIST)) {
      expect(names.has(entry), entry).toBe(true);
    }
  });

  test("self-check: assertOptionalMatterAccess does not satisfy the lead rule", () => {
    const [fn] = exportedAsyncFunctions(
      `export async function f(leadId: string) { await assertOptionalMatterAccess(null); }`,
    );
    expect(checkLeadFunction(fn)).not.toBeNull();
    const [ok] = exportedAsyncFunctions(
      `export async function f(leadId: string) { await assertLeadAccess(leadId); }`,
    );
    expect(checkLeadFunction(ok)).toBeNull();
  });
});
