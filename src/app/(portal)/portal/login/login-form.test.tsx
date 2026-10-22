import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/actions/portal-session", () => ({
  requestPortalLink: vi.fn(async () => ({ status: "sent" })),
}));

import { LoginForm } from "./login-form";

describe("portal login form", () => {
  test("shows the uniform copy after a request", async () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email me a link" }));
    await waitFor(() =>
      expect(
        screen.getByText("If that email has portal access, a link is on its way."),
      ).toBeTruthy(),
    );
  });
});

describe("portal login form, after sending", () => {
  test("echoes the typed address and can start over", async () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email me a link" }));
    await waitFor(() => expect(screen.getByText("a@b.com")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
