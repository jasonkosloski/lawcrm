import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";

import PortalNotFound from "./not-found";

describe("portal 404", () => {
  test("links back to portal home only", () => {
    const { container } = render(<PortalNotFound />);
    expect(screen.getByText("Page not found")).toBeTruthy();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/"]);
    expect(screen.getByRole("link", { name: "Go to my matters" })).toBeTruthy();
  });
});
