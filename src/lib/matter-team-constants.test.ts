/**
 * Tests for matter-team role constants. Same purpose as
 * expense-constants.test — guard against label/key drift.
 */

import { describe, expect, test } from "vitest";
import {
  MATTER_TEAM_ROLES,
  MATTER_TEAM_ROLE_LABEL,
  matterTeamRoleLabel,
} from "./matter-team-constants";

describe("MATTER_TEAM_ROLES", () => {
  test("includes the canonical four (lead is the only single-occupancy role)", () => {
    expect(MATTER_TEAM_ROLES).toContain("lead");
    expect(MATTER_TEAM_ROLES).toContain("co_counsel");
    expect(MATTER_TEAM_ROLES).toContain("paralegal");
    expect(MATTER_TEAM_ROLES).toContain("investigator");
    expect(MATTER_TEAM_ROLES).toContain("of_counsel");
  });

  test("every role has a label", () => {
    for (const r of MATTER_TEAM_ROLES) {
      expect(MATTER_TEAM_ROLE_LABEL[r]).toBeTruthy();
    }
  });
});

describe("matterTeamRoleLabel", () => {
  test("known roles → human label", () => {
    expect(matterTeamRoleLabel("lead")).toBe("Lead attorney");
    expect(matterTeamRoleLabel("co_counsel")).toBe("Co-counsel");
  });

  test("unknown role falls through to the raw key", () => {
    // Defensive: legacy or future-added roles shouldn't render
    // as undefined — show the slug instead.
    expect(matterTeamRoleLabel("captain")).toBe("captain");
  });
});
