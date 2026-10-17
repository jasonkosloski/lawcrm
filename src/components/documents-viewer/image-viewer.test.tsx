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
    expect(
      screen.getByRole("button", { name: /fit scene photo\.jpg/i })
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("the image keeps its alt text", () => {
    render(<ImageViewer src="/img.png" name="Scene photo.jpg" />);
    expect(screen.getByAltText("Scene photo.jpg")).toBeInTheDocument();
  });
});
