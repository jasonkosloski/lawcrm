import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const signOutPortal = vi.fn(async () => {});
vi.mock("@/app/actions/portal-session", () => ({
  signOutPortal: () => signOutPortal(),
}));

import { SignOutButton } from "./sign-out-button";

const original = window.location;
afterEach(() => {
  Object.defineProperty(window, "location", { value: original, configurable: true });
});

describe("portal sign-out button", () => {
  test("calls the action then navigates to /login", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true });
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(signOutPortal).toHaveBeenCalledTimes(1);
  });
});
