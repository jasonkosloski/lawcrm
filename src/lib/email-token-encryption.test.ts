/**
 * Tests for the EmailAccount token-encryption Prisma extension.
 *
 * Two layers in one file:
 *   - pure unit tests for the data-mapping helpers
 *     (`encryptTokenWrites` / `decryptTokenReads`);
 *   - integration tests against the real test Postgres proving the
 *     invariant end-to-end: **plaintext in the app, ciphertext in
 *     the database** — on create, update, upsert, and `{ set }`.
 *
 * EMAIL_TOKEN_KEY comes from src/test/setup.ts.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import { encryptToken, isEncryptedToken } from "./email-token-crypto";
import { decryptTokenReads, encryptTokenWrites } from "./email-token-encryption";

// ── Unit: data-mapping helpers ──────────────────────────────────────────

describe("encryptTokenWrites", () => {
  it("encrypts plain-string token fields, leaves the rest alone", () => {
    const out = encryptTokenWrites({
      accessToken: "plain-access",
      refreshToken: "plain-refresh",
      emailAddress: "x@y.com",
    });
    expect(isEncryptedToken(out.accessToken)).toBe(true);
    expect(isEncryptedToken(out.refreshToken)).toBe(true);
    expect(out.emailAddress).toBe("x@y.com");
  });

  it("encrypts the { set } update form", () => {
    const out = encryptTokenWrites({ accessToken: { set: "plain" } });
    expect(isEncryptedToken((out.accessToken as { set: string }).set)).toBe(
      true
    );
  });

  it("passes through null and absent fields", () => {
    const out = encryptTokenWrites({
      accessToken: null,
      syncStatus: "connected",
    });
    expect(out.accessToken).toBeNull();
    expect(out.syncStatus).toBe("connected");
  });

  it("does not double-encrypt already-encrypted values", () => {
    const stored = encryptToken("once");
    const out = encryptTokenWrites({ accessToken: stored });
    expect(out.accessToken).toBe(stored);
  });

  it("handles createMany-style arrays", () => {
    const out = encryptTokenWrites([
      { accessToken: "a" },
      { accessToken: "b" },
    ]);
    expect(out.every((row) => isEncryptedToken(row.accessToken))).toBe(true);
  });
});

describe("decryptTokenReads", () => {
  it("decrypts rows and arrays of rows", () => {
    const row = { accessToken: encryptToken("a"), refreshToken: null };
    expect(decryptTokenReads(row).accessToken).toBe("a");
    expect(decryptTokenReads([row, row]).map((r) => r.accessToken)).toEqual([
      "a",
      "a",
    ]);
  });

  it("passes through batch payloads and nulls", () => {
    expect(decryptTokenReads(null)).toBeNull();
    expect(decryptTokenReads({ count: 3 })).toEqual({ count: 3 });
  });
});

// ── Integration: the invariant, end-to-end ──────────────────────────────

describe("emailAccount token encryption (integration)", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    const { firmId } = await seedFirm();
    ({ userId } = await seedUser({ firmId }));
  });

  async function rawTokens(id: string) {
    const rows = await prisma.$queryRaw<
      Array<{ accessToken: string | null; refreshToken: string | null }>
    >`SELECT "accessToken", "refreshToken" FROM email_accounts WHERE id = ${id}`;
    return rows[0];
  }

  it("stores ciphertext on create, returns plaintext on read", async () => {
    const created = await prisma.emailAccount.create({
      data: {
        userId,
        emailAddress: "jason@example.com",
        accessToken: "access-plain",
        refreshToken: "refresh-plain",
      },
    });
    // The app-facing result is already plaintext.
    expect(created.accessToken).toBe("access-plain");
    expect(created.refreshToken).toBe("refresh-plain");

    // The database row is not.
    const raw = await rawTokens(created.id);
    expect(raw.accessToken).not.toBe("access-plain");
    expect(isEncryptedToken(raw.accessToken!)).toBe(true);
    expect(isEncryptedToken(raw.refreshToken!)).toBe(true);

    // And a fresh read decrypts.
    const fetched = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(fetched.accessToken).toBe("access-plain");
    expect(fetched.refreshToken).toBe("refresh-plain");
  });

  it("encrypts on update — both plain and { set } forms", async () => {
    const { id } = await prisma.emailAccount.create({
      data: { userId, emailAddress: "jason@example.com" },
      select: { id: true },
    });

    const updated = await prisma.emailAccount.update({
      where: { id },
      data: { accessToken: "rotated", refreshToken: { set: "rotated-r" } },
    });
    expect(updated.accessToken).toBe("rotated");
    expect(updated.refreshToken).toBe("rotated-r");

    const raw = await rawTokens(id);
    expect(isEncryptedToken(raw.accessToken!)).toBe(true);
    expect(isEncryptedToken(raw.refreshToken!)).toBe(true);
  });

  it("encrypts through upsert on both branches", async () => {
    const where = {
      userId_emailAddress: { userId, emailAddress: "up@example.com" },
    };
    // Create branch.
    await prisma.emailAccount.upsert({
      where,
      create: {
        userId,
        emailAddress: "up@example.com",
        accessToken: "via-create",
      },
      update: { accessToken: "via-update" },
    });
    // Update branch.
    const second = await prisma.emailAccount.upsert({
      where,
      create: {
        userId,
        emailAddress: "up@example.com",
        accessToken: "via-create",
      },
      update: { accessToken: "via-update" },
    });
    expect(second.accessToken).toBe("via-update");
    const raw = await rawTokens(second.id);
    expect(isEncryptedToken(raw.accessToken!)).toBe(true);
  });

  it("leaves null tokens null and decrypts lists", async () => {
    await prisma.emailAccount.create({
      data: { userId, emailAddress: "no-tokens@example.com" },
    });
    await prisma.emailAccount.create({
      data: {
        userId,
        emailAddress: "with-tokens@example.com",
        accessToken: "listed",
      },
    });
    const all = await prisma.emailAccount.findMany({
      orderBy: { emailAddress: "asc" },
    });
    expect(all[0].accessToken).toBeNull();
    expect(all[1].accessToken).toBe("listed");
  });
});
