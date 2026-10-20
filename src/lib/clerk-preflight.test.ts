import { describe, expect, it } from "vitest";
import {
  describeDatabaseUrl,
  formatPreflight,
  summarizePreflight,
} from "./clerk-preflight";

describe("describeDatabaseUrl", () => {
  it("returns host and a 6-char user prefix, never the password", () => {
    const d = describeDatabaseUrl(
      "postgresql://abcdefghij:s3cretpw@db.example.com:5432/app"
    );
    expect(d).toEqual({ host: "db.example.com:5432", userPrefix: "abcdef" });
    expect(JSON.stringify(d)).not.toContain("s3cretpw");
  });
  it("handles missing and garbage input", () => {
    expect(describeDatabaseUrl(undefined).host).toMatch(/not set/);
    expect(describeDatabaseUrl("nope").host).toMatch(/unparseable/);
  });
});

describe("summarizePreflight / formatPreflight", () => {
  const users = [
    { email: "Leo@KosloskiLaw.com", name: "Leo", clerkUserId: "c1" },
    { email: "x@gmail.com", name: "Contractor", clerkUserId: null },
  ];
  it("flags non-firm emails (case-insensitive) and counts linked", () => {
    const s = summarizePreflight(users);
    expect(s.outsideFirmDomain.map((u) => u.email)).toEqual(["x@gmail.com"]);
    expect(s.linked).toBe(1);
    expect(s.total).toBe(2);
  });
  it("prints the host first and no password", () => {
    const out = formatPreflight(
      describeDatabaseUrl("postgresql://abcdefghij:pw123@h.example:5432/d"),
      summarizePreflight(users)
    );
    expect(out.split("\n")[0]).toContain("h.example:5432");
    expect(out).toContain("Contractor <x@gmail.com>");
    expect(out).not.toContain("pw123");
  });
});
