import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LeadStageChip } from "./lead-stage-chip";

describe("LeadStageChip", () => {
  it("labels known stages and colours new / converted", () => {
    render(<LeadStageChip stage="converted" />);
    expect(screen.getByText("Converted")).toHaveClass("text-ok");
  });

  it("falls back to the raw slug for unknown stages", () => {
    render(<LeadStageChip stage="mystery" />);
    expect(screen.getByText("mystery")).toHaveClass("text-ink-3");
  });
});
