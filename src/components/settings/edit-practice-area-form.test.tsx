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
  statutePeriodDays: 3 * 365,
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

    const years = field("statuteYears");
    const days = field("statuteDays");
    expect(years.value).toBe("3");

    await user.clear(years);
    await user.type(days, "300");
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

    expect(field("statuteYears").value).toBe("");
    expect(field("statuteDays").value).toBe("300");
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
      "Years",
      "Months",
      "Days",
      "Source citation",
      "Default billing mode",
    ]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
  });

  test("months are documented as approximate", () => {
    render(<EditPracticeAreaForm area={area} />);
    expect(screen.getByText(/months are therefore approximate/i)).toBeTruthy();
  });
});
