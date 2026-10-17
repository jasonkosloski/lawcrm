/**
 * NewIntakeForm — linking a repeat caller to their existing contact.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/leads", () => ({ createLead: vi.fn() }));

import { NewIntakeForm } from "./new-intake-form";

const contacts = [
  { id: "c1", name: "Dana Reyes", email: "dana@example.com", phone: "303-555-0142", type: "client" },
  { id: "c2", name: "Pat Moore", email: "pat@example.com", phone: null, type: "witness" },
];

const hiddenContactId = () =>
  (document.querySelector('input[name="contactId"]') as HTMLInputElement).value;

describe("NewIntakeForm", () => {
  it("typing a name suggests existing contacts; picking one links it", async () => {
    const user = userEvent.setup();
    render(<NewIntakeForm contacts={contacts} />);
    await user.type(screen.getByPlaceholderText(/start typing/i), "dan");
    await user.click(screen.getByRole("button", { name: /Dana Reyes/ }));
    expect(hiddenContactId()).toBe("c1");
    expect(screen.getByText(/Existing contact · dana@example.com · 303-555-0142/)).toBeInTheDocument();
    // Email/phone inputs give way to the linked record.
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /not this person/i }));
    expect(hiddenContactId()).toBe("");
    expect(screen.getByPlaceholderText(/start typing/i)).toHaveValue("");
  });

  it("warns that a typed email belongs to an existing contact, and offers to use it", async () => {
    const user = userEvent.setup();
    render(<NewIntakeForm contacts={contacts} />);
    await user.type(screen.getByPlaceholderText(/start typing/i), "Patricia");
    await user.type(screen.getByLabelText(/^email$/i), "PAT@example.com");
    expect(screen.getByText("Pat Moore")).toBeInTheDocument();
    expect(screen.getByText(/will be linked to that contact/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /use their record/i }));
    expect(hiddenContactId()).toBe("c2");
  });
});
