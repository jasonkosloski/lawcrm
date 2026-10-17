/**
 * LoginForm — the email survives a failed sign-in (React 19 resets
 * uncontrolled fields after the action settles; the action echoes the
 * email back so the reset lands on it), the password never does.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/auth", () => ({ loginAction: vi.fn() }));

import { loginAction } from "@/app/actions/auth";
import { LoginForm } from "@/components/auth/login-form";

beforeEach(() => {
  vi.mocked(loginAction).mockReset();
});

describe("LoginForm", () => {
  test("keeps the typed email after a failed sign-in, clears the password", async () => {
    vi.mocked(loginAction).mockImplementation(async (_prev, fd) => ({
      status: "error",
      error: "Invalid email or password.",
      email: String(fd.get("email")),
    }));
    const user = userEvent.setup();
    render(<LoginForm next="/matters" />);

    await user.type(screen.getByLabelText(/email/i), "pat@kosloskilaw.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText(/email/i)).toHaveValue("pat@kosloskilaw.com");
    expect(screen.getByLabelText(/password/i)).toHaveValue("");
  });

  test("round-trips the sanitised next target as a hidden field", async () => {
    vi.mocked(loginAction).mockResolvedValue({ status: "idle" });
    const user = userEvent.setup();
    const { container } = render(<LoginForm next="/matters/abc" />);
    expect(container.querySelector('input[name="next"]')).toHaveValue(
      "/matters/abc"
    );
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.type(screen.getByLabelText(/password/i), "x");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(vi.mocked(loginAction).mock.calls[0][1].get("next")).toBe(
      "/matters/abc"
    );
  });
});
