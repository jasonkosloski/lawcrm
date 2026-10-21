import { describe, expect, test } from "vitest";
import { decideEmail } from "@/lib/notification-email-policy";

const base = {
  userActive: true,
  read: false,
  hasMatterAccess: true,
  category: "tasks" as const,
  mode: "instant" as const,
  muted: false,
};

describe("decideEmail", () => {
  test.each([
    ["instant sends", {}, "send"],
    ["inactive user skips", { userActive: false }, "skip"],
    ["read row skips", { read: true }, "skip"],
    ["lost matter access skips", { hasMatterAccess: false }, "skip"],
    ["off skips", { mode: "off" }, "skip"],
    ["muted matter skips", { muted: true }, "skip"],
    ["digest holds", { mode: "digest" }, "hold"],
    ["mute does not skip deadlines", { category: "deadlines", muted: true }, "send"],
    ["deadline digest holds", { category: "deadlines", mode: "digest" }, "hold"],
    ["inactive beats digest", { userActive: false, mode: "digest" }, "skip"],
  ] as const)("%s", (_name, override, expected) => {
    expect(decideEmail({ ...base, ...override })).toBe(expected);
  });
});
