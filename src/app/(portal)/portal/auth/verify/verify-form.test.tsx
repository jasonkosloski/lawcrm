import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let result = "invalid";
vi.mock("@/app/actions/portal-session", () => ({
  verifyPortalLink: vi.fn(async () => ({ status: result })),
  requestPortalLink: vi.fn(async () => ({ status: "sent" })),
}));

import { VerifyForm } from "./verify-form";

describe("portal verify form", () => {
  test("an invalid result shows the expired copy and a Send a new link form", async () => {
    render(<VerifyForm token="t" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(
        screen.getByText("This link has expired or was already used.")
      ).toBeTruthy()
    );
    expect(screen.getByLabelText("Email")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send a new link" }));
    await waitFor(() =>
      expect(
        screen.getByText("If that email has portal access, a link is on its way.")
      ).toBeTruthy()
    );
  });

  test("an ok result does a full navigation to /", async () => {
    result = "ok";
    const replace = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { value: { replace }, configurable: true });
    render(<VerifyForm token="t" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    Object.defineProperty(window, "location", { value: original, configurable: true });
    result = "invalid";
  });
});
