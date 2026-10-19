import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/actions/portal-session", () => ({
  verifyPortalLink: vi.fn(async () => ({ status: "invalid" })),
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
});
