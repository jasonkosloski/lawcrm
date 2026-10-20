// @vitest-environment node
//
// Node environment for the same reason as proxy.test.ts: the proxy is
// server code, and happy-dom's Request drops forbidden headers.

/**
 * vercel.json cron wiring.
 *
 * Vercel Cron GETs each path with `Authorization: Bearer <CRON_SECRET>`
 * and no session cookie. A cron is only real if (1) the path is an
 * actual GET route handler and (2) the auth proxy lets a cookieless
 * request through — the proxy once redirected these to /login, so the
 * jobs silently never ran.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

// Clerk's wrapper would verify a session token (needs real keys); run
// our handler directly with a signed-out `auth()`. The cron paths are
// self-authenticated, so the handler never consults it.
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware:
    (handler: (...a: unknown[]) => unknown) =>
    (req: unknown, evt: unknown) =>
      handler(async () => ({ userId: null }), req, evt),
}));

import { proxy } from "./proxy";

type Cron = { path: string; schedule: string };

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8")
) as { crons?: Cron[] };
const crons = config.crons ?? [];

describe("vercel.json crons", () => {
  it("schedules the email sync and notification sweep", () => {
    expect(crons.map((c) => c.path).sort()).toEqual([
      "/api/email-sync",
      "/api/notification-sweep",
    ]);
  });

  it.each(crons)("$path has a 5-field cron schedule", ({ schedule }) => {
    expect(schedule.trim().split(/\s+/)).toHaveLength(5);
  });

  it.each(crons)("$path maps to a GET route handler", ({ path: p }) => {
    const file = path.join(__dirname, "app", p, "route.ts");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toMatch(
      /export async function GET\b/
    );
  });

  it.each(crons)("$path passes the proxy without a session", async ({ path: p }) => {
    const res = (await proxy(
      new NextRequest(new URL(p, "https://app.example.com"), {
        headers: { authorization: "Bearer cron-secret" },
      }),
      {} as NextFetchEvent
    )) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
  });
});

const root = path.join(__dirname, "..");
const readRoot = (...parts: string[]): string =>
  fs.readFileSync(path.join(root, ...parts), "utf8");

describe(".env.example documents what the crons and Google sync need", () => {
  const envExample = readRoot(".env.example");

  it("lists CRON_SECRET (both cron routes 401 without it)", () => {
    expect(envExample).toMatch(/^CRON_SECRET=/m);
  });

  it("tells operators to enable the Calendar API and the calendar.events scope", () => {
    expect(envExample).toMatch(/Google Calendar API/);
    expect(envExample).toMatch(/calendar\.events/);
  });
});

describe("tooling wiring", () => {
  const pkg = JSON.parse(readRoot("package.json")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };

  it("runs the migration drift check from the pre-commit hook when prisma/ is staged", () => {
    expect(readRoot(".husky", "pre-commit")).toMatch(/check:migrations/);
    expect(pkg.scripts["check:migrations"]).toBe(
      "node scripts/check-migrations.mjs"
    );
    expect(fs.existsSync(path.join(root, "scripts", "check-migrations.mjs"))).toBe(
      true
    );
  });

  it("keeps the Prisma packages on one exact version (CLI, client, adapter)", () => {
    const versions = new Set([
      pkg.dependencies["prisma"],
      pkg.dependencies["@prisma/client"],
      pkg.dependencies["@prisma/adapter-pg"],
    ]);
    expect(versions.size).toBe(1);
    expect([...versions][0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("declares dotenv, which prisma.config.ts and the seed import", () => {
    expect(pkg.dependencies["dotenv"]).toBeTruthy();
  });

  it("exposes the coverage run that enforces the vitest thresholds", () => {
    expect(pkg.scripts["test:coverage"]).toMatch(/--coverage/);
  });
});
