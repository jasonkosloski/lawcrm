import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("Badge status tones", () => {
  it.each([
    ["ok", "text-ok"],
    ["warn", "text-warn"],
    ["danger", "text-danger"],
    ["neutral", "text-ink-3"],
  ] as const)("%s uses its tint", (variant, text) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    expect(screen.getByText(variant)).toHaveClass(text, "rounded-full", "h-5");
  });

  it("defaults to the brand tone", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toHaveClass("bg-brand-soft", "text-brand-700");
  });
});
