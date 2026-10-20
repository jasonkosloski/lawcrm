/**
 * The /login screen's presentational shell: it renders the app's name
 * as the page's one h1, a labelled sign-in section, and whatever
 * sign-in control the page passes in.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginScreen } from "./login-screen";

describe("LoginScreen", () => {
  test("renders the title, the sign-in section, and the action slot", () => {
    render(<LoginScreen action={<button type="button">Sign in now</button>} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "LitGox"
    );
    const section = screen.getByRole("region", { name: "Sign in" });
    expect(section).toContainElement(
      screen.getByRole("button", { name: "Sign in now" })
    );
  });
});
