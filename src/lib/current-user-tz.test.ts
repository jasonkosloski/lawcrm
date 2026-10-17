/**
 * getCurrentUserTimeZone — the session guard must propagate, the
 * lookup may fall back.
 *
 * `cache()` is a passthrough under Vitest's client React build, so
 * each test gets a fresh evaluation without extra stubbing.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TIME_ZONE,
  getCurrentUserTimeZone,
} from "@/lib/current-user-tz";

const mockedId = vi.mocked(getCurrentUserId);
const mockedFind = vi.mocked(prisma.user.findUnique);

/** Shape of the error `redirect()` throws (digest NEXT_REDIRECT;…). */
function redirectError() {
  return Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;replace;/login;307;",
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getCurrentUserTimeZone", () => {
  test("returns the user's stored zone", async () => {
    mockedId.mockResolvedValue("u1");
    mockedFind.mockResolvedValue({ timeZone: "America/Chicago" } as never);
    await expect(getCurrentUserTimeZone()).resolves.toBe("America/Chicago");
  });

  test("a missing user row falls back to the default", async () => {
    mockedId.mockResolvedValue("u1");
    mockedFind.mockResolvedValue(null as never);
    await expect(getCurrentUserTimeZone()).resolves.toBe(DEFAULT_TIME_ZONE);
  });

  test("a signed-out session's redirect propagates (not swallowed)", async () => {
    mockedId.mockRejectedValue(redirectError());
    await expect(getCurrentUserTimeZone()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockedFind).not.toHaveBeenCalled();
  });

  test("a Next control-flow error from the lookup propagates", async () => {
    mockedId.mockResolvedValue("u1");
    mockedFind.mockRejectedValue(redirectError());
    await expect(getCurrentUserTimeZone()).rejects.toThrow("NEXT_REDIRECT");
  });

  test("a genuine lookup failure falls back to the default and is logged", async () => {
    mockedId.mockResolvedValue("u1");
    mockedFind.mockRejectedValue(new Error("pool timeout"));
    await expect(getCurrentUserTimeZone()).resolves.toBe(DEFAULT_TIME_ZONE);
    expect(console.error).toHaveBeenCalled();
  });
});
