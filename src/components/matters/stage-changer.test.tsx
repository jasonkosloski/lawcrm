/**
 * StageChanger — `matters.edit` gating. The stepper renders for
 * everyone; the "Change stage" control only for users who'd pass the
 * `updateMatterStage` permission check.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/actions/matters", () => ({
  updateMatterStage: vi.fn(),
}));

import { StageChanger, type StageOption } from "./stage-changer";

const stages: StageOption[] = [
  { id: "s1", name: "Intake", order: 1, isTerminal: false },
  { id: "s2", name: "Discovery", order: 2, isTerminal: false },
  { id: "s3", name: "Closed", order: 3, isTerminal: true },
];

describe("StageChanger — permission gating", () => {
  test("editors see the Change stage control", () => {
    render(
      <StageChanger matterId="m1" stages={stages} currentStageId="s2" canEdit />
    );
    expect(screen.getByText("Change stage")).toBeInTheDocument();
  });

  test("non-editors see the stepper but no Change stage control", () => {
    render(
      <StageChanger
        matterId="m1"
        stages={stages}
        currentStageId="s2"
        canEdit={false}
      />
    );
    expect(screen.queryByText("Change stage")).not.toBeInTheDocument();
    expect(screen.getAllByText("Discovery").length).toBeGreaterThan(0);
  });
});
