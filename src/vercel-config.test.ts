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
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
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

  it.each(crons)("$path passes the proxy without a session cookie", ({ path: p }) => {
    const res = proxy(
      new NextRequest(new URL(p, "https://app.example.com"), {
        headers: { authorization: "Bearer cron-secret" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
  });
});
