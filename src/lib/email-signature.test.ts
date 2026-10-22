/**
 * Signature lookup + wrapping. The save-side sanitize is covered with
 * the action in src/app/actions/profile.test.ts.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
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
