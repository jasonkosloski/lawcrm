import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffAppUrl, staffAuthorizedParties } from "./staff-authorized-parties";

const KEYS = [
  "STAFF_ORIGINS",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "AUTH_URL",
  "PORTAL_HOST",
];

beforeEach(() => {
  for (const k of KEYS) vi.stubEnv(k, "");
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => vi.unstubAllEnvs());

describe("staffAuthorizedParties", () => {
  it("STAFF_ORIGINS wins and ignores the Vercel heuristic", () => {
    vi.stubEnv("STAFF_ORIGINS", "https://crm.example.com, https://b.example.com");
    vi.stubEnv("VERCEL_URL", "hash.vercel.app");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "portal.example.com");
    expect(staffAuthorizedParties()).toEqual(["https://crm.example.com", "https://b.example.com"]);
  });

  it("drops malformed STAFF_ORIGINS entries (paths, junk, other schemes)", () => {
    vi.stubEnv(
      "STAFF_ORIGINS",
      "https://ok.example.com,not a url,https://x.example.com/path,ftp://f.example.com,",
    );
    expect(staffAuthorizedParties()).toEqual(["https://ok.example.com"]);
  });

  it("heuristic: branch, deployment, production and AUTH_URL origins, deduped", () => {
    vi.stubEnv("VERCEL_BRANCH_URL", "app-git-feat-x.vercel.app");
    vi.stubEnv("VERCEL_URL", "app-abc.vercel.app");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "crm.example.com");
    vi.stubEnv("AUTH_URL", "https://crm.example.com/");
    expect(staffAuthorizedParties()).toEqual([
      "https://app-git-feat-x.vercel.app",
      "https://app-abc.vercel.app",
      "https://crm.example.com",
    ]);
  });

  it("heuristic excludes the portal host", () => {
    vi.stubEnv("PORTAL_HOST", "portal.example.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "portal.example.com");
    vi.stubEnv("VERCEL_URL", "app-abc.vercel.app");
    expect(staffAuthorizedParties()).toEqual(["https://app-abc.vercel.app"]);
  });

  it("ignores a malformed AUTH_URL", () => {
    vi.stubEnv("VERCEL_URL", "app-abc.vercel.app");
    vi.stubEnv("AUTH_URL", "not a url");
    expect(staffAuthorizedParties()).toEqual(["https://app-abc.vercel.app"]);
  });

  it("production with nothing usable fails closed (never empty/undefined)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(staffAuthorizedParties()).toEqual(["https://invalid.invalid"]);
    vi.stubEnv("STAFF_ORIGINS", "junk");
    expect(staffAuthorizedParties()).toEqual(["https://invalid.invalid"]);
    err.mockRestore();
  });

  it("development adds localhost:3000", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(staffAuthorizedParties()).toEqual(["http://localhost:3000"]);
    vi.stubEnv("STAFF_ORIGINS", "https://crm.example.com");
    expect(staffAuthorizedParties()).toEqual(["https://crm.example.com", "http://localhost:3000"]);
  });

  it("production never includes localhost", () => {
    vi.stubEnv("STAFF_ORIGINS", "https://crm.example.com");
    expect(staffAuthorizedParties()).not.toContain("http://localhost:3000");
  });
});

describe("staffAppUrl", () => {
  it("returns the first non-localhost origin in production", () => {
    vi.stubEnv("STAFF_ORIGINS", "https://crm.example.com,https://b.example.com");
    expect(staffAppUrl()).toBe("https://crm.example.com");
  });

  it("is null in production with nothing configured", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(staffAppUrl()).toBeNull();
    err.mockRestore();
  });

  it("falls back to localhost outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(staffAppUrl()).toBe("http://localhost:3000");
  });
});
