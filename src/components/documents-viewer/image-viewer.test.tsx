/**
 * ImageViewer zoom is a real, keyboard-operable button (F1003).
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageViewer } from "./image-viewer";

describe("ImageViewer", () => {
  test("zoom toggles via a focusable button with aria-pressed", async () => {
    render(<ImageViewer src="/img.png" name="Scene photo.jpg" />);
    const button = screen.getByRole("button", { name: /zoom scene photo\.jpg/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /fit scene photo\.jpg/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the image keeps its alt text", () => {
    render(<ImageViewer src="/img.png" name="Scene photo.jpg" />);
    expect(screen.getByAltText("Scene photo.jpg")).toBeInTheDocument();
  });
});

describe("ImageViewer — sizing", () => {
  test("fit mode sizes the image against the pane, not a percentage chain", () => {
    // Regression: max-h-full inside the flex column never resolved, so a
    // tall photo scaled to the width and was cropped top and bottom.
    render(<ImageViewer src="/big.png" name="big.png" />);
    const img = screen.getByAltText("big.png");
    expect(img).toHaveClass("h-full", "w-full", "object-contain");
    expect(img.parentElement).toHaveClass("absolute");
    expect(img.parentElement?.parentElement).toHaveClass("relative", "overflow-hidden");
  });

  test("zoomed mode shows the real size inside a scrolling pane", async () => {
    render(<ImageViewer src="/big.png" name="big.png" />);
    await userEvent.click(screen.getByRole("button", { name: /zoom big\.png/i }));
    const img = screen.getByAltText("big.png");
    expect(img).toHaveClass("max-w-none");
    expect(img.closest(".overflow-auto")).not.toBeNull();
  });
});
