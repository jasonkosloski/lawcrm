import { describe, expect, test } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { focusFirstInvalid, useRequiredHints, VenueField } from "./required-field-ui";

describe("useRequiredHints", () => {
  test("hint and reqHint follow the required keys", () => {
    const { result } = renderHook(() => useRequiredHints("Civil Rights", ["court"]));
    expect(result.current.isRequired("court")).toBe(true);
    expect(result.current.isRequired("venue")).toBe(false);
    expect(result.current.requiredHint).toBe("Required for Civil Rights");
    expect(result.current.reqHint("court")).toBe("Required for Civil Rights");
    expect(result.current.reqHint("court", "More.")).toBe("Required for Civil Rights. More.");
    expect(result.current.reqHint("venue", "More.")).toBe("More.");
    expect(result.current.reqHint("venue")).toBeUndefined();
  });
});

describe("VenueField", () => {
  test("shows the default hint, the required hint, and hides the hint on error", () => {
    const { rerender } = render(
      <VenueField required={false} requiredHint="Required for X">
        <input aria-label="v" />
      </VenueField>,
    );
    expect(screen.getByText("The court or jurisdiction the case is in.")).toBeTruthy();
    rerender(
      <VenueField required requiredHint="Required for X">
        <input aria-label="v" />
      </VenueField>,
    );
    expect(screen.getByText("Required for X")).toBeTruthy();
    rerender(
      <VenueField required requiredHint="Required for X" error="Bad">
        <input aria-label="v" />
      </VenueField>,
    );
    expect(screen.queryByText("Required for X")).toBeNull();
  });
});

describe("focusFirstInvalid", () => {
  test("focuses the earliest field in DOM order, not key order", () => {
    render(
      <form data-testid="f">
        <input name="court" />
        <input type="hidden" name="clientId" />
        <input name="newClientName" />
        <input name="caseNumber" />
      </form>,
    );
    const form = screen.getByTestId("f") as HTMLFormElement;
    focusFirstInvalid(form, ["caseNumber", "client", "court"]);
    expect(form.querySelector('[name="court"]')).toHaveFocus();
    focusFirstInvalid(form, ["caseNumber", "client"]);
    expect(form.querySelector('[name="newClientName"]')).toHaveFocus();
  });

  test("venue targets the combobox input", () => {
    render(
      <form data-testid="f">
        <input type="hidden" name="venueId" />
        <input aria-label="Venue" />
      </form>,
    );
    const form = screen.getByTestId("f") as HTMLFormElement;
    focusFirstInvalid(form, ["venue"]);
    expect(screen.getByLabelText("Venue")).toHaveFocus();
  });
});
