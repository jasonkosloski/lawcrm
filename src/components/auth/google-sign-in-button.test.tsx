import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sso = vi.fn();
vi.mock("@clerk/nextjs", () => ({
  useSignIn: () => ({ signIn: { sso } }),
}));

import { GoogleSignInButton } from "./google-sign-in-button";

afterEach(() => vi.clearAllMocks());

describe("GoogleSignInButton", () => {
  test("starts the Google SSO flow with the callback and destination", async () => {
    sso.mockResolvedValue({ error: null });
    render(<GoogleSignInButton next="/matters?tab=notes" />);
    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i })
    );
    expect(sso).toHaveBeenCalledWith({
      strategy: "oauth_google",
      redirectCallbackUrl: "/sso-callback?next=%2Fmatters%3Ftab%3Dnotes",
      redirectUrl: "/matters?tab=notes",
    });
  });

  test("shows a retry message and logs Clerk's reason when Clerk returns an error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sso.mockResolvedValue({ error: { message: "boom" } });
    render(<GoogleSignInButton next="/" />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /google sign-in didn't start/i
    );
    await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
    expect(logged).toHaveBeenCalledWith(
      "[auth] Google sign-in did not start:",
      { message: "boom" }
    );
    logged.mockRestore();
  });

  test("shows it when the call throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sso.mockRejectedValue(new Error("network"));
    render(<GoogleSignInButton next="/" />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
