import { describe, expect, test } from "vitest";
import { Circle, DollarSign, Briefcase, ShieldCheck } from "lucide-react";
import { ACTIVITY_ICONS, activityIcon } from "@/lib/activity-icons";

describe("activityIcon", () => {
  test("resolves the money / matter / security icons the dashboard used to drop", () => {
    expect(activityIcon("dollar")).toBe(DollarSign);
    expect(activityIcon("briefcase")).toBe(Briefcase);
    expect(activityIcon("shield")).toBe(ShieldCheck);
  });

  test("unknown, empty and prototype-property names fall back to a circle", () => {
    expect(activityIcon("nope")).toBe(Circle);
    expect(activityIcon("")).toBe(Circle);
    expect(activityIcon(null)).toBe(Circle);
    expect(activityIcon("constructor")).toBe(Circle);
    expect(activityIcon("toString")).toBe(Circle);
  });

  test("covers every icon name defaultIconFor() can write", () => {
    for (const name of [
      "note",
      "check",
      "gavel",
      "clock",
      "video",
      "mail",
      "phone",
      "document",
      "shield",
      "zap",
    ]) {
      expect(ACTIVITY_ICONS[name], name).toBeDefined();
    }
  });
});
