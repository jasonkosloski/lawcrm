import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PortalError from "./error";

describe("portal error boundary", () => {
  test("offers a retry and a link to portal home, no staff copy or links", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const { container } = render(
      <PortalError error={new Error("db down at postgres://x")} retry={retry} />,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/dashboard/i);
    expect(text).not.toContain("postgres");
    // Only link: portal home ("/" is rewritten to the portal on its host).
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/"]);
    err.mockRestore();
  });
});
