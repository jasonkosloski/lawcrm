/**
 * Tests for FirmEditForm.
 *
 * Pins the establishedAt <input type="date"> value to the UTC
 * calendar day. establishedAt is a date-only value stored at UTC
 * midnight; formatting it with local Date getters renders the
 * previous day for any browser west of UTC (and mismatches the
 * UTC-server SSR output). The test forces a west-of-UTC zone via
 * process.env.TZ so a regression to local getters fails loudly.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock the server action BEFORE importing the component so the
// import inside the component resolves to the mock.
vi.mock("@/app/actions/firm", () => ({
  updateFirmAction: vi.fn(),
}));

import { FirmEditForm } from "./firm-edit-form";
import type { FirmGoals, FirmProfile } from "@/lib/firm";

const BASE_GOALS: FirmGoals = {
  dailyHoursGoal: 6.0,
  monthlyBillableGoal: 200,
};

const BASE_FIRM: FirmProfile = {
  id: "firm_1",
  name: "Kosloski Law",
  shortName: null,
  ein: null,
  website: null,
  phone: null,
  email: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  zip: null,
  country: "US",
  establishedAt: null,
  logoUrl: null,
};

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  // West of UTC — local getters on a UTC-midnight Date yield the
  // PREVIOUS calendar day here, which is exactly the bug this
  // suite guards against. Node re-reads TZ at runtime, so this
  // takes effect for every Date call below.
  process.env.TZ = "America/Denver";
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

function establishedInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[name="establishedAt"]'
  );
  if (!input) throw new Error("establishedAt input not rendered");
  return input;
}

describe("FirmEditForm — establishedAt date input", () => {
  test("renders the UTC calendar day, not the local (west-of-UTC) day", () => {
    const { container } = render(
      <FirmEditForm
        firm={{
          ...BASE_FIRM,
          // Date-only value as stored: UTC midnight. In Denver this
          // instant is still July 3 — local getters would emit
          // "1998-07-03".
          establishedAt: new Date("1998-07-04T00:00:00.000Z"),
        }}
        goals={BASE_GOALS}
      />
    );
    expect(establishedInput(container).defaultValue).toBe("1998-07-04");
  });

  test("zero-pads single-digit month and day", () => {
    const { container } = render(
      <FirmEditForm
        firm={{
          ...BASE_FIRM,
          establishedAt: new Date("2003-01-05T00:00:00.000Z"),
        }}
        goals={BASE_GOALS}
      />
    );
    expect(establishedInput(container).defaultValue).toBe("2003-01-05");
  });

  test("renders empty when establishedAt is null", () => {
    const { container } = render(
      <FirmEditForm firm={BASE_FIRM} goals={BASE_GOALS} />
    );
    expect(establishedInput(container).defaultValue).toBe("");
  });
});

describe("FirmEditForm — goal inputs", () => {
  test("renders both goals as editable number inputs with the firm values", () => {
    const { container } = render(
      <FirmEditForm
        firm={BASE_FIRM}
        goals={{ dailyHoursGoal: 7.5, monthlyBillableGoal: 180 }}
      />
    );
    const daily = container.querySelector<HTMLInputElement>(
      'input[name="dailyHoursGoal"]'
    );
    const monthly = container.querySelector<HTMLInputElement>(
      'input[name="monthlyBillableGoal"]'
    );
    expect(daily?.type).toBe("number");
    expect(daily?.defaultValue).toBe("7.5");
    expect(daily?.max).toBe("24");
    expect(monthly?.type).toBe("number");
    expect(monthly?.defaultValue).toBe("180");
    expect(monthly?.max).toBe("744");
  });
});
