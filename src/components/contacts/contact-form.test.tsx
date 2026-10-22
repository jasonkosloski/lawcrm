/**
 * Tests for the shared contact form.
 *
 * Pins: the type select has an accessible name, typed values survive a
 * validation error (the React 19 form reset must not wipe them), field
 * errors render under their field, a successful EDIT navigates back to
 * `backHref`, and a successful create (the action redirects itself)
 * does not navigate from the client.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContactFormState } from "@/lib/contact-form";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ContactForm } from "./contact-form";

const action = vi.fn<(prev: ContactFormState, fd: FormData) => Promise<ContactFormState>>();

beforeEach(() => {
  vi.clearAllMocks();
  action.mockResolvedValue({ status: "idle" });
});

describe("ContactForm", () => {
  test("the contact type select is named, and defaults to Other", () => {
    render(
      <ContactForm
        action={action}
        submitLabel="Create contact"
        backHref="/contacts"
        redirectsOnSuccess
      />,
    );
    expect(screen.getByRole("combobox", { name: /contact type/i })).toHaveValue("other");
  });

  test("submits every field as FormData", async () => {
    const user = userEvent.setup();
    render(
      <ContactForm
        action={action}
        submitLabel="Create contact"
        backHref="/contacts"
        redirectsOnSuccess
      />,
    );

    await user.type(screen.getByPlaceholderText("Full name"), "Dana Whitfield");
    await user.selectOptions(screen.getByRole("combobox", { name: /contact type/i }), "client");
    await user.type(screen.getByPlaceholderText("email@example.com"), "d@x.com");
    await user.click(screen.getByRole("button", { name: "Create contact" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = action.mock.calls[0][1];
    expect(fd.get("name")).toBe("Dana Whitfield");
    expect(fd.get("type")).toBe("client");
    expect(fd.get("email")).toBe("d@x.com");
  });

  test("keeps what was typed and shows the field error after a validation failure", async () => {
    action.mockResolvedValue({
      status: "error",
      errors: { email: ["Enter a valid email address"] },
    });
    const user = userEvent.setup();
    render(
      <ContactForm
        action={action}
        submitLabel="Create contact"
        backHref="/contacts"
        redirectsOnSuccess
      />,
    );

    await user.type(screen.getByPlaceholderText("Full name"), "Dana Whitfield");
    await user.type(screen.getByPlaceholderText("email@example.com"), "bad");
    await user.click(screen.getByRole("button", { name: "Create contact" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Full name")).toHaveValue("Dana Whitfield");
    expect(screen.getByPlaceholderText("email@example.com")).toHaveValue("bad");
    expect(push).not.toHaveBeenCalled();
  });

  test("a successful edit navigates back to backHref", async () => {
    action.mockResolvedValue({ status: "ok", contactId: "c1" });
    const user = userEvent.setup();
    render(
      <ContactForm
        action={action}
        initial={{ name: "Dana Whitfield", type: "client" }}
        submitLabel="Save changes"
        backHref="/contacts/c1"
        redirectsOnSuccess={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/contacts/c1"));
  });

  test("create flow never navigates from the client (the action redirects)", async () => {
    action.mockResolvedValue({ status: "ok", contactId: "c1" });
    const user = userEvent.setup();
    render(
      <ContactForm
        action={action}
        submitLabel="Create contact"
        backHref="/contacts"
        redirectsOnSuccess
      />,
    );

    await user.type(screen.getByPlaceholderText("Full name"), "Dana");
    await user.click(screen.getByRole("button", { name: "Create contact" }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });
});
