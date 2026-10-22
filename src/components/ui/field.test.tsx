import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, FieldError, formErrorMessage, inputClass, textareaClass } from "./field";

describe("Field", () => {
  it("with htmlFor, labels the control and wires the first error to it", () => {
    render(
      <Field label="Name" htmlFor="name" error={["Required", "Too short"]}>
        <input id="name" />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "name-error");
    expect(screen.getByText("Required")).toHaveAttribute("id", "name-error");
    expect(screen.queryByText("Too short")).toBeNull();
  });

  it("shows the hint only when there is no error", () => {
    render(
      <Field label="Email" htmlFor="email" hint="Work address">
        <input id="email" />
      </Field>,
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-describedby", "email-hint");
    expect(screen.getByText("Work address")).toBeInTheDocument();
  });

  it("without htmlFor, wraps the control so the label still names it", () => {
    render(
      <Field label="City" required error="Pick one">
        <input />
      </Field>,
    );
    expect(screen.getByLabelText(/City/)).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(screen.getByText("Pick one")).toBeInTheDocument();
  });

  it("render prop gets a generated id and aria attributes", () => {
    render(
      <Field label="Role" error="Taken">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText("Role");
    expect(input.id).not.toBe("");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-error`);
  });
});

describe("FieldError", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<FieldError>{undefined}</FieldError>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("inputClass", () => {
  it("sizes and error border", () => {
    expect(inputClass()).toContain("h-8");
    expect(inputClass(false, "xs")).toContain("h-7");
    expect(inputClass(true, "md")).toContain("h-9");
    expect(inputClass(true)).toContain("border-warn");
    expect(inputClass(false)).toContain("border-line");
  });

  it("textareaClass has no fixed height", () => {
    expect(textareaClass()).not.toMatch(/\bh-\d/);
    expect(textareaClass(true)).toContain("border-warn");
  });
});

describe("formErrorMessage", () => {
  it("prefers _form, falls back only when there are no field errors", () => {
    expect(formErrorMessage({ status: "idle" }, "x")).toBeNull();
    expect(formErrorMessage({ status: "error", errors: { _form: ["Nope"] } }, "x")).toBe("Nope");
    expect(formErrorMessage({ status: "error", errors: { name: ["Bad"] } }, "x")).toBeNull();
    expect(formErrorMessage({ status: "error" }, "Failed")).toBe("Failed");
  });
});
