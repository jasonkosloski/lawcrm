/**
 * Signature lookup + wrapping. The save-side sanitize is covered with
 * the action in src/app/actions/profile.test.ts.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import { sanitizeOutgoingEmailHtml, sanitizeUserHtml } from "@/lib/sanitize-html";
import { getEmailSignature, normalizeEmailSignature, wrapEmailSignature } from "./email-signature";

describe("normalizeEmailSignature", () => {
  test("empty or whitespace-only HTML is no signature", () => {
    expect(normalizeEmailSignature("")).toBeNull();
    expect(normalizeEmailSignature("<p></p>")).toBeNull();
    expect(normalizeEmailSignature("<p> </p><p><br></p>")).toBeNull();
    expect(normalizeEmailSignature("<script>x</script>")).toBeNull();
  });
});

describe("wrapEmailSignature", () => {
  test("puts the caret line and delimiter above the signature", () => {
    expect(wrapEmailSignature("<p>Jane</p>")).toBe("<p></p><p>-- </p><p>Jane</p>");
  });

  test("re-sanitizes stored HTML", () => {
    const html = wrapEmailSignature('<p>Jane<img src="https://t.example/p.gif"></p>');
    expect(html).toBe("<p></p><p>-- </p><p>Jane</p>");
  });

  test("null or empty stored value is no signature", () => {
    expect(wrapEmailSignature(null)).toBeNull();
    expect(wrapEmailSignature("<p></p>")).toBeNull();
  });
});

describe("getEmailSignature", () => {
  let userId: string;

  beforeAll(() => {
    expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
  });

  beforeEach(async () => {
    await resetDb();
    const { firmId } = await seedFirm();
    ({ userId } = await seedUser({ firmId }));
  });

  test("null when the user has none", async () => {
    expect(await getEmailSignature(userId)).toBeNull();
  });

  test("the stored signature, composer-ready", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { emailSignature: "<p><strong>Jane</strong></p>" },
    });
    expect(await getEmailSignature(userId)).toBe("<p></p><p>-- </p><p><strong>Jane</strong></p>");
  });
});

describe("outgoing profile (Email editor)", () => {
  test("keeps allowed formatting the note profile stripped", () => {
    const html =
      '<p style="margin-bottom:12pt;color:red">Jane</p>' +
      "<table><tbody><tr><td><p>Firm</p></td></tr></tbody></table>";
    const out = normalizeEmailSignature(html);
    expect(out).toContain("margin-bottom:12pt");
    expect(out).not.toContain("color");
    expect(out).toContain("<table>");
  });

  test("signature saved under the note profile round-trips unchanged", () => {
    const current =
      '<p><strong>Jane Doe</strong><br>Partner</p><p><a href="https://firm.example" target="_blank" rel="noopener noreferrer">firm.example</a> ' +
      '<a href="mailto:jane@firm.example" target="_blank" rel="noopener noreferrer">email</a></p>' +
      "<ul><li><p>One</p></li></ul><blockquote><p>Quote</p></blockquote><pre><code>x</code></pre>";
    expect(normalizeEmailSignature(sanitizeUserHtml(current))).toBe(sanitizeUserHtml(current));
    expect(wrapEmailSignature(current)).toBe(`<p></p><p>-- </p>${sanitizeUserHtml(current)}`);
  });

  test("a wrapped signature appended to a body passes the outgoing sanitizer once, intact", () => {
    const body = '<p style="margin-bottom:12pt">Hi</p>';
    const wrapped = wrapEmailSignature('<p style="line-height:1.5">Jane</p>') as string;
    const combined = body + wrapped;
    expect(sanitizeOutgoingEmailHtml(combined)).toBe(combined);
  });
});
