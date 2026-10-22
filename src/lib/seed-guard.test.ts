import { describe, expect, test } from "vitest";
import { checkDestructiveDbAllowed, isDestructivePrismaInvocation } from "./seed-guard";

const REMOTE = "postgresql://u:p@db.prisma.io:5432/postgres";
const LOCAL = "postgresql://u:p@localhost:5433/lawcrm_test";

describe("checkDestructiveDbAllowed", () => {
  test("allows localhost, 127.0.0.1 and ::1", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(
        checkDestructiveDbAllowed({
          DATABASE_URL: `postgresql://u:p@${host}:5432/x`,
        }).ok,
      ).toBe(true);
    }
  });

  test("refuses a remote host and says why", () => {
    const res = checkDestructiveDbAllowed({ DATABASE_URL: REMOTE });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain("db.prisma.io");
      expect(res.reason).toContain("ALLOW_SEED=1");
    }
  });

  test("checks DIRECT_DATABASE_URL too (migrate reset uses it)", () => {
    const res = checkDestructiveDbAllowed({
      DATABASE_URL: LOCAL,
      DIRECT_DATABASE_URL: REMOTE,
    });
    expect(res.ok).toBe(false);
  });

  test("ALLOW_SEED=1 opts a remote dev database in", () => {
    expect(checkDestructiveDbAllowed({ DATABASE_URL: REMOTE, ALLOW_SEED: "1" }).ok).toBe(true);
  });

  test("production environments are refused even with ALLOW_SEED=1", () => {
    expect(
      checkDestructiveDbAllowed({
        DATABASE_URL: LOCAL,
        ALLOW_SEED: "1",
        VERCEL_ENV: "production",
      }).ok,
    ).toBe(false);
    expect(
      checkDestructiveDbAllowed({
        DATABASE_URL: LOCAL,
        NODE_ENV: "production",
      }).ok,
    ).toBe(false);
  });

  test("refuses when no URL is configured or the URL is unparseable", () => {
    expect(checkDestructiveDbAllowed({}).ok).toBe(false);
    expect(checkDestructiveDbAllowed({ DATABASE_URL: "not a url" }).ok).toBe(false);
  });
});

describe("isDestructivePrismaInvocation", () => {
  const argv = (...a: string[]) => ["node", "prisma", ...a];
  test("flags migrate reset, db seed and --force-reset only", () => {
    expect(isDestructivePrismaInvocation(argv("migrate", "reset", "--force"))).toBe(true);
    expect(isDestructivePrismaInvocation(argv("db", "seed"))).toBe(true);
    expect(isDestructivePrismaInvocation(argv("db", "push", "--force-reset"))).toBe(true);
    expect(isDestructivePrismaInvocation(argv("migrate", "deploy"))).toBe(false);
    expect(isDestructivePrismaInvocation(argv("migrate", "status"))).toBe(false);
    expect(isDestructivePrismaInvocation(argv("generate"))).toBe(false);
  });
});
