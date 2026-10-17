/**
 * ChangePasswordForm — a rejected change keeps what was typed; a
 * successful one clears every field.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/auth", () => ({ changePasswordAction: vi.fn() }));

import { changePasswordAction } from "@/app/actions/auth";
import { ChangePasswordForm } from "@/components/settings/change-password-form";

beforeEach(() => {
  vi.mocked(changePasswordAction).mockReset();
});

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("Current password"),
    "old passphrase here"
  );
  await user.type(
    screen.getByLabelText("New password"),
    "a brand new passphrase"
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "a brand new passphras"
  );
}

describe("ChangePasswordForm", () => {
  test("a confirm mismatch keeps all three fields", async () => {
    vi.mocked(changePasswordAction).mockResolvedValue({
      status: "error",
      errors: { confirmPassword: ["Passwords don't match."] },
    });
    const user = userEvent.setup();
    render(<ChangePasswordForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /change password/i }));

    await screen.findByText("Passwords don't match.");
    expect(screen.getByLabelText("Current password")).toHaveValue(
      "old passphrase here"
    );
    expect(screen.getByLabelText("New password")).toHaveValue(
      "a brand new passphrase"
    );
    expect(screen.getByLabelText("Confirm new password")).toHaveValue(
      "a brand new passphras"
    );
  });

  test("success clears every field and reports other devices signed out", async () => {
    vi.mocked(changePasswordAction).mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    render(<ChangePasswordForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /change password/i }));

    await screen.findByText(/other devices have been signed out/i);
    await waitFor(() =>
      expect(screen.getByLabelText("Current password")).toHaveValue("")
    );
    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
  });
});
