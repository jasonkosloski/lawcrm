/**
 * Tests for EditPracticeAreaForm.
 *
 * Regression: React 19 resets a <form>'s uncontrolled fields to their
 * defaultValue after EVERY form action, including one that returns a
 * validation error. The SOL period / citation / checkbox were
 * uncontrolled and seeded from the stored row, so a name-collision
 * error silently put the old 3-year period back while the name kept
 * the admin's text; fixing the name and saving then persisted the OLD
 * period. All fields are controlled now.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/practice-areas", () => ({
  updatePracticeArea: vi.fn(),
}));

import { updatePracticeArea } from "@/app/actions/practice-areas";
import { EditPracticeAreaForm } from "./edit-practice-area-form";

const mockedUpdate = vi.mocked(updatePracticeArea);

const area = {
  id: "pa1",
  name: "Employment/CADA",
  label: null,
  color: "#2563a8",
  hasStatuteOfLimitations: true,
  statutePeriodAmount: 3,
  statutePeriodUnit: "YEARS" as const,
  statuteSourceCitation: "C.R.S. § 13-80-101",
  defaultBillingMode: "client",
};

beforeEach(() => {
  mockedUpdate.mockReset();
  mockedUpdate.mockImplementation(async () => ({
    status: "error" as const,
    errors: { name: ["Another practice area already uses that name"] },
    values: {},
  }));
});

describe("EditPracticeAreaForm after a server validation error", () => {
  test("keeps the edited SOL period, citation and unchecked toggle", async () => {
    const user = userEvent.setup();
    const { container } = render(<EditPracticeAreaForm area={area} />);
    const field = (name: string) =>
      container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

    const amount = field("statutePeriodAmount");
    const unit = container.querySelector<HTMLSelectElement>(
      'select[name="statutePeriodUnit"]'
    )!;
    expect(amount.value).toBe("3");
    expect(unit.value).toBe("YEARS");

    await user.clear(amount);
    await user.type(amount, "300");
    await user.selectOptions(unit, "DAYS");
    const citation = field("statuteSourceCitation");
    await user.clear(citation);
    await user.type(citation, "C.R.S. § 13-80-102");
    await user.click(
      screen.getByRole("checkbox", { name: /track statute of limitations/i })
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/another practice area already uses that name/i)
      ).toBeTruthy()
    );

    expect(field("statutePeriodAmount").value).toBe("300");
    expect(
      container.querySelector<HTMLSelectElement>(
        'select[name="statutePeriodUnit"]'
      )!.value
    ).toBe("DAYS");
    expect(field("statuteSourceCitation").value).toBe("C.R.S. § 13-80-102");
    expect(
      (
        screen.getByRole("checkbox", {
          name: /track statute of limitations/i,
        }) as HTMLInputElement
      ).checked
    ).toBe(false);
  });

  test("the SOL copy says turning it off keeps existing matters' SOL data", () => {
    render(<EditPracticeAreaForm area={area} />);
    expect(
      screen.getByText(/existing matters keep their sol dates/i)
    ).toBeTruthy();
  });

  test("every control has an accessible name", () => {
    render(<EditPracticeAreaForm area={area} />);
    for (const name of [
      "Name",
      "Label",
      "Color",
      "Amount",
      "Unit",
      "Source citation",
      "Default billing mode",
    ]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
  });

  test("explains calendar arithmetic and the month-end rule", () => {
    render(<EditPracticeAreaForm area={area} />);
    expect(screen.getByText(/last day/i)).toBeTruthy();
  });

  test("an unconfigured area defaults the unit to years with a blank amount", () => {
    const { container } = render(
      <EditPracticeAreaForm
        area={{ ...area, statutePeriodAmount: null, statutePeriodUnit: null }}
      />
    );
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="statutePeriodAmount"]'
      )!.value
    ).toBe("");
    expect(
      container.querySelector<HTMLSelectElement>(
        'select[name="statutePeriodUnit"]'
      )!.value
    ).toBe("YEARS");
  });
});

describe("EditPracticeAreaForm matter-name template and required fields", () => {
  test("posts checked required fields, the presence marker and a blank template", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockImplementation(async () => ({
      status: "ok" as const,
      errors: {},
      values: {},
    }));
    render(
      <EditPracticeAreaForm
        area={{ ...area, matterNameTemplate: null, requiredMatterFields: ["venue"] }}
        firmTemplate="{client_full} - {year}"
      />
    );
    expect(
      (screen.getByRole("checkbox", { name: "Venue" }) as HTMLInputElement).checked
    ).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Case number" }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    const fd = mockedUpdate.mock.calls[0][2] as FormData;
    expect(fd.getAll("requiredMatterFields")).toEqual(["venue", "caseNumber"]);
    expect(fd.get("requiredMatterFieldsPresent")).toBe("1");
    expect(fd.get("matterNameTemplate")).toBe("");
  });
});
