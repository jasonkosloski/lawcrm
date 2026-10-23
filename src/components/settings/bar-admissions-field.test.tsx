/**
 * BarAdmissionsField — add / remove rows, the JSON the form posts,
 * and the error message.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BarAdmissionsField } from "@/components/settings/bar-admissions-field";

function posted(container: HTMLElement): string {
  return (container.querySelector('input[name="barAdmissions"]') as HTMLInputElement).value;
}

describe("BarAdmissionsField", () => {
  test("renders the default rows", () => {
    render(
      <BarAdmissionsField
        defaultValue={[
          { state: "CO", number: "12345" },
          { state: "NY", number: "999" },
        ]}
      />,
    );
    const states = screen.getAllByLabelText("State") as HTMLSelectElement[];
    expect(states.map((s) => s.value)).toEqual(["CO", "NY"]);
    const numbers = screen.getAllByLabelText("Bar number") as HTMLInputElement[];
    expect(numbers.map((n) => n.value)).toEqual(["12345", "999"]);
  });

  test("with no rows the hidden input still posts []", () => {
    const { container } = render(<BarAdmissionsField defaultValue={[]} />);
    expect(posted(container)).toBe("[]");
  });

  test("add two rows, remove one: the hidden input holds the remaining row", async () => {
    const user = userEvent.setup();
    const { container } = render(<BarAdmissionsField defaultValue={[]} />);
    await user.click(screen.getByRole("button", { name: /add admission/i }));
    await user.click(screen.getByRole("button", { name: /add admission/i }));
    const states = screen.getAllByLabelText("State");
    const numbers = screen.getAllByLabelText("Bar number");
    await user.selectOptions(states[0], "CO");
    await user.type(numbers[0], "111");
    await user.selectOptions(states[1], "TX");
    await user.type(numbers[1], "222");
    expect(posted(container)).toBe(
      JSON.stringify([
        { state: "CO", number: "111" },
        { state: "TX", number: "222" },
      ]),
    );
    await user.click(screen.getAllByLabelText("Remove admission")[0]);
    expect(posted(container)).toBe(JSON.stringify([{ state: "TX", number: "222" }]));
  });

  test("empty rows are left out; half-filled rows are posted for the server to reject", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BarAdmissionsField defaultValue={[{ state: "CO", number: "1" }]} />,
    );
    await user.click(screen.getByRole("button", { name: /add admission/i }));
    expect(posted(container)).toBe(JSON.stringify([{ state: "CO", number: "1" }]));
    await user.type(screen.getAllByLabelText("Bar number")[1], "777");
    expect(posted(container)).toBe(
      JSON.stringify([
        { state: "CO", number: "1" },
        { state: "", number: "777" },
      ]),
    );
  });

  test("removing every row posts []", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BarAdmissionsField defaultValue={[{ state: "CO", number: "1" }]} />,
    );
    await user.click(screen.getByLabelText("Remove admission"));
    expect(posted(container)).toBe("[]");
  });

  test("shows the error and the hint", () => {
    render(<BarAdmissionsField defaultValue={[]} error="Duplicate state" />);
    expect(screen.getByText("Duplicate state")).toBeTruthy();
    expect(screen.getByText("Bar admissions")).toBeTruthy();
  });
});
