/**
 * Tests for EditMatterForm.
 *
 * Pins the statute-of-limitations edit behaviour (an auto-derived SOL
 * shows as a live preview and leaves the override input empty; a real
 * manual override stays pre-filled), the lead-attorney lock without
 * matters.manage_team, the inactive client/lead options, and that a
 * validation error does NOT reset the user's <select> choices (React
 * 19 resets forms driven by `action={fn}`; the form submits via
 * onSubmit instead).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const posted = vi.hoisted(() => ({ calls: [] as FormData[] }));
const nextState = vi.hoisted(() => ({
  current: { status: "idle" } as {
    status: "idle" | "error";
    errors?: Record<string, string[]>;
    values?: Record<string, string>;
  },
}));

vi.mock("@/app/actions/matters", () => ({
  updateMatter: vi.fn(async (_id: string, _prev: unknown, fd: FormData) => {
    posted.calls.push(fd);
    return nextState.current;
  }),
}));

import {
  EditMatterForm,
  type EditMatterFormOptions,
  type MatterForEdit,
} from "./edit-matter-form";

const options: EditMatterFormOptions = {
  areas: [
    {
      id: "civil",
      name: "Civil Rights",
      hasStatuteOfLimitations: true,
      statutePeriod: { amount: 2, unit: "YEARS" as const },
      statuteSourceCitation: "C.R.S. § 13-80-102",
      stages: [
        { id: "civil-intake", name: "Intake", order: 0, isTerminal: false },
        { id: "civil-disc", name: "Discovery", order: 1, isTerminal: false },
      ],
    },
    {
      id: "emp",
      name: "Employment",
      hasStatuteOfLimitations: false,
      statutePeriod: null,
      statuteSourceCitation: null,
      stages: [{ id: "emp-intake", name: "Intake", order: 0, isTerminal: false }],
    },
    {
      id: "short",
      name: "Short SOL",
      hasStatuteOfLimitations: true,
      statutePeriod: { amount: 1, unit: "YEARS" as const },
      statuteSourceCitation: null,
      stages: [{ id: "short-intake", name: "Intake", order: 0, isTerminal: false }],
    },
  ],
  clients: [
    { id: "c1", name: "Maria Alvarez", organization: null, inactive: true },
    { id: "c2", name: "Zed Other", organization: null },
  ],
  users: [
    { id: "u-lead", name: "Dana Lead", jobTitle: "Attorney", inactive: true },
    { id: "u2", name: "Eli Active", jobTitle: "Paralegal" },
  ],
};

const matter: MatterForEdit = {
  id: "m1",
  name: "Alvarez v. City",
  caseNumber: null,
  practiceAreaId: "civil",
  stageId: "civil-intake",
  feeStructure: "contingent",
  billingMode: "hourly",
  court: null,
  clientId: "c1",
  opposingParty: null,
  opposingFirm: null,
  description: null,
  leadUserId: "u-lead",
  // 2024-06-01 + 730 days = 2026-06-01 -> auto-derived.
  incidentDate: new Date("2024-06-01T00:00:00Z"),
  statuteOfLimitationsDate: new Date("2026-06-01T00:00:00Z"),
  statuteOfLimitationsNotes: null,
};

beforeEach(() => {
  posted.calls.length = 0;
  nextState.current = { status: "idle" };
});

describe("EditMatterForm — SOL auto vs override", () => {
  test("an auto-derived SOL leaves the override empty and previews the computed date", () => {
    render(<EditMatterForm matter={matter} options={options} canChangeLead />);
    expect(screen.getByLabelText(/deadline date/i)).toHaveValue("");
    expect(screen.getByText(/auto-computed: jun 1, 2026/i)).toBeTruthy();
  });

  test("the preview recomputes live from the incident date and the selected area", async () => {
    const user = userEvent.setup();
    render(<EditMatterForm matter={matter} options={options} canChangeLead />);

    const incident = screen.getByLabelText(/incident/i);
    await user.clear(incident);
    await user.type(incident, "2024-03-01");
    expect(screen.getByText(/auto-computed: mar 1, 2026/i)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText(/practice area/i), "short");
    // 2024-03-01 + 365 days (2024 is a leap year) = 2025-03-01.
    expect(screen.getByText(/auto-computed: mar 1, 2025/i)).toBeTruthy();
  });

  test("a real manual override stays pre-filled and can be reset to computed", async () => {
    const user = userEvent.setup();
    render(
      <EditMatterForm
        matter={{
          ...matter,
          statuteOfLimitationsDate: new Date("2027-01-15T00:00:00Z"),
        }}
        options={options}
        canChangeLead
      />
    );
    expect(screen.getByLabelText(/deadline date/i)).toHaveValue("2027-01-15");
    expect(screen.getByText(/manual override/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /reset to computed/i }));
    expect(screen.getByLabelText(/deadline date/i)).toHaveValue("");
  });

  test("an auto-derived SOL posts an empty override so the server recomputes", async () => {
    const user = userEvent.setup();
    render(<EditMatterForm matter={matter} options={options} canChangeLead />);
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(posted.calls).toHaveLength(1));
    expect(posted.calls[0].get("statuteOfLimitationsDate")).toBe("");
    expect(posted.calls[0].get("incidentDate")).toBe("2024-06-01");
  });

  test("an area without SOL tracking says the SOL data is kept", async () => {
    const user = userEvent.setup();
    render(<EditMatterForm matter={matter} options={options} canChangeLead />);
    await user.selectOptions(screen.getByLabelText(/practice area/i), "emp");
    expect(screen.queryByLabelText(/deadline date/i)).toBeNull();
    expect(screen.getByText(/kept as they are/i)).toBeTruthy();
  });
});

describe("EditMatterForm — people", () => {
  test("the inactive current client and lead stay in the lists and selected", () => {
    render(<EditMatterForm matter={matter} options={options} canChangeLead />);
    expect(screen.getByLabelText(/^client/i)).toHaveValue("c1");
    expect(
      screen.getByRole("option", { name: /maria alvarez \(inactive\)/i })
    ).toBeTruthy();
    expect(screen.getByLabelText(/lead attorney/i)).toHaveValue("u-lead");
    expect(
      screen.getByRole("option", { name: /dana lead.*\(inactive\)/i })
    ).toBeTruthy();
  });

  test("without manage_team the lead is locked and still posted unchanged", async () => {
    const user = userEvent.setup();
    render(<EditMatterForm matter={matter} options={options} />);
    expect(screen.getByLabelText(/lead attorney/i)).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(posted.calls).toHaveLength(1));
    expect(posted.calls[0].getAll("leadUserId")).toEqual(["u-lead"]);
  });

  test("a matter with no lead shows a placeholder instead of picking the first user", () => {
    render(
      <EditMatterForm
        matter={{ ...matter, leadUserId: null }}
        options={options}
        canChangeLead
      />
    );
    expect(screen.getByLabelText(/lead attorney/i)).toHaveValue("");
  });
});

describe("EditMatterForm — validation error keeps the user's selections (F095)", () => {
  test("selects and the area/stage survive a server error and are re-posted", async () => {
    const user = userEvent.setup();
    nextState.current = {
      status: "error",
      errors: { description: ["Summary is too long"] },
      values: {},
    };
    render(<EditMatterForm matter={matter} options={options} canChangeLead />);

    await user.selectOptions(screen.getByLabelText(/fee structure/i), "hourly");
    await user.selectOptions(screen.getByLabelText(/^client/i), "c2");
    await user.selectOptions(screen.getByLabelText(/lead attorney/i), "u2");
    await user.selectOptions(screen.getByLabelText(/stage/i), "civil-disc");

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(posted.calls).toHaveLength(1));
    // Wait for the error state to render.
    await screen.findByText(/summary is too long/i);

    expect(screen.getByLabelText(/fee structure/i)).toHaveValue("hourly");
    expect(screen.getByLabelText(/^client/i)).toHaveValue("c2");
    expect(screen.getByLabelText(/lead attorney/i)).toHaveValue("u2");
    expect(screen.getByLabelText(/stage/i)).toHaveValue("civil-disc");

    // Fix the field and resubmit: the post carries the user's picks,
    // not the mount-time defaults.
    nextState.current = { status: "idle" };
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(posted.calls).toHaveLength(2));
    const second = posted.calls[1];
    expect(second.get("feeStructure")).toBe("hourly");
    expect(second.get("clientId")).toBe("c2");
    expect(second.get("leadUserId")).toBe("u2");
    expect(second.get("stageId")).toBe("civil-disc");
    expect(second.get("practiceAreaId")).toBe("civil");
  });
});
