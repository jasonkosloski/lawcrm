import { describe, expect, test, vi } from "vitest";

const calls: string[] = [];
vi.mock("@/lib/portal-access", () => ({
  requirePortalIdentity: vi.fn(async () => {
    calls.push("guard");
    return { identityId: "i", contactId: "c", email: "a@b.com" };
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    calls.push("notFound");
    throw new Error("NOT_FOUND");
  }),
}));

import PortalCatchAll from "./page";

describe("portal catch-all", () => {
  test("authenticates first, then renders the portal 404", async () => {
    await expect(PortalCatchAll()).rejects.toThrow("NOT_FOUND");
    expect(calls).toEqual(["guard", "notFound"]);
  });
});
