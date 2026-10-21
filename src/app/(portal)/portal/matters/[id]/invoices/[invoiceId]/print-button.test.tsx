import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintButton } from "./print-button";

describe("PrintButton", () => {
  test("Download PDF calls window.print and is hidden when printing", async () => {
    const print = vi.fn();
    window.print = print; // jsdom does not implement print
    render(<PrintButton />);
    const btn = screen.getByRole("button", { name: /Download PDF/ });
    expect(btn.className).toContain("print:hidden");
    await userEvent.click(btn);
    expect(print).toHaveBeenCalledTimes(1);
  });
});
