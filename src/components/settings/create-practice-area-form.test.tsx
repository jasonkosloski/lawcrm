/**
 * Tests for CreatePracticeAreaForm.
 *
 * Regression: React 19 resets a <form action={fn}> after every
 * submission, including one that returns a validation error. The SOL
 * checkbox was uncontrolled, so a name collision came back with SOL
 * unchecked and the admin re-created the area without SOL tracking.
 * The form now submits via onSubmit + startTransition with controlled
 * fields.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/practice-areas", () => ({
  createPracticeArea: vi.fn(),
}));

import { createPracticeArea } from "@/app/actions/practice-areas";
import { CreatePracticeAreaForm } from "./create-practice-area-form";

const mockedCreate = vi.mocked(createPracticeArea);

beforeEach(() => {
  mockedCreate.mockReset();
  mockedCreate.mockImplementation(async () => ({
    status: "error" as const,
    errors: { name: ["Another practice area already uses that name"] },
    values: {},
  }));
});

describe("CreatePracticeAreaForm after a server validation error", () => {
  test("keeps the typed name and the checked SOL toggle", async () => {
    const user = userEvent.setup();
    render(<CreatePracticeAreaForm />);

    await user.type(screen.getByPlaceholderText(/1983, Employment/i), "§1983");
    await user.click(
      screen.getByRole("checkbox", { name: /track statute of limitations/i })
    );
    await user.click(screen.getByRole("button", { name: /add area/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/another practice area already uses that name/i)
      ).toBeTruthy()
    );
    // The action received the SOL flag.
    const fd = mockedCreate.mock.calls[0][1] as FormData;
    expect(fd.get("hasStatuteOfLimitations")).toBe("on");

    expect(
      (
        screen.getByRole("checkbox", {
          name: /track statute of limitations/i,
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      (screen.getByPlaceholderText(/1983, Employment/i) as HTMLInputElement)
        .value
    ).toBe("§1983");
  });
});
