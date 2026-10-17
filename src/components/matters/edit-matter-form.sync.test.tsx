/**
 * EditMatterForm — props that change after mount, dates, and a11y.
 *
 * Regression pinned: the lead select used to be uncontrolled, so after
 * the Team card (same page) promoted a new lead and the page re-rendered
 * with the new `matter.leadUserId`, the select kept showing the old lead
 * and the next Save posted it, silently reverting the team change.
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

import { parseDateOnly } from "@/lib/format-date";
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
      statuteSourceCitation: null,
      stages: [{ id: "s1", name: "Intake", order: 0, isTerminal: false }],
    },
  ],
  clients: [
    { id: "c1", name: "Maria Alvarez", organization: null },
    { id: "c2", name: "Zed Other", organization: null },
  ],
  users: [
    { id: "alice", name: "Alice Lead", jobTitle: "Attorney" },
    { id: "bob", name: "Bob New", jobTitle: "Attorney" },
  ],
};

const matter: MatterForEdit = {
  id: "m1",
  name: "Alvarez v. City",
  caseNumber: null,
  practiceAreaId: "civil",
  stageId: "s1",
  feeStructure: "contingent",
  billingMode: "hourly",
  court: null,
  clientId: "c1",
  opposingParty: null,
  opposingFirm: null,
  description: null,
  leadUserId: "alice",
  incidentDate: parseDateOnly("2024-06-01"),
  statuteOfLimitationsDate: parseDateOnly("2026-06-01"),
  statuteOfLimitationsNotes: null,
};

beforeEach(() => {
  posted.calls.length = 0;
  nextState.current = { status: "idle" };
});

describe("EditMatterForm — stale selects after the page re-renders", () => {
  test("a lead changed by the Team card is shown and posted, not reverted to the old lead", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <EditMatterForm matter={matter} options={options} canChangeLead />
    );
    expect(screen.getByLabelText(/lead attorney/i)).toHaveValue("alice");

    // Team card promoted Bob; revalidation re-renders with the new lead.
    rerender(
      <EditMatterForm
        matter={{ ...matter, leadUserId: "bob" }}
        options={options}
        canChangeLead
      />
    );
    expect(screen.getByLabelText(/lead attorney/i)).toHaveValue("bob");

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(posted.calls).toHaveLength(1));
    expect(posted.calls[0].get("leadUserId")).toBe("bob");
  });

  test("a lead the user picked is kept when an unrelated prop re-renders", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <EditMatterForm matter={matter} options={options} canChangeLead />
    );
    await user.selectOptions(screen.getByLabelText(/lead attorney/i), "bob");
    rerender(
      <EditMatterForm
        matter={{ ...matter, name: "Alvarez v. City (renamed)" }}
        options={options}
        canChangeLead
      />
    );
    expect(screen.getByLabelText(/lead attorney/i)).toHaveValue("bob");
  });

  test("a client re-linked elsewhere is reflected", () => {
    const { rerender } = render(
      <EditMatterForm matter={matter} options={options} canChangeLead />
    );
    rerender(
      <EditMatterForm
        matter={{ ...matter, clientId: "c2" }}
        options={options}
        canChangeLead
      />
    );
    expect(screen.getByLabelText(/^client/i)).toHaveValue("c2");
  });

  test("a stale echoed lead from an earlier failed save does not beat a newer team change", async () => {
    const user = userEvent.setup();
    nextState.current = {
      status: "error",
      errors: { description: ["Too long"] },
      values: { leadUserId: "alice" },
    };
    const { rerender } = render(
      <EditMatterForm matter={matter} options={options} canChangeLead />
    );
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await screen.findByText("Too long");

    rerender(
      <EditMatterForm
        matter={{ ...matter, leadUserId: "bob" }}
        options={options}
        canChangeLead
      />
    );
    expect(screen.getByLabelText(/lead attorney/i)).toHaveValue("bob");
  });
});

describe("EditMatterForm — date-only values", () => {
  test("incident date prefills and previews on the stored calendar day (no zone shift)", () => {
    render(<EditMatterForm matter={matter} options={options} canChangeLead />);
    expect(screen.getByLabelText(/incident/i)).toHaveValue("2024-06-01");
    // 2024-06-01 + 730 days
    expect(screen.getByText(/auto-computed: jun 1, 2026/i)).toBeTruthy();
  });

  test("a manual override prefills its stored day", () => {
    render(
      <EditMatterForm
        matter={{
          ...matter,
          statuteOfLimitationsDate: parseDateOnly("2027-01-15"),
        }}
        options={options}
        canChangeLead
      />
    );
    expect(screen.getByLabelText(/deadline date/i)).toHaveValue("2027-01-15");
  });
});

describe("EditMatterForm — accessibility", () => {
  test("a field error is announced via aria-invalid + aria-describedby", async () => {
    const user = userEvent.setup();
    nextState.current = {
      status: "error",
      errors: { description: ["Summary is too long"] },
      values: {},
    };
    render(<EditMatterForm matter={matter} options={options} canChangeLead />);
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await screen.findByText("Summary is too long");

    const summary = screen.getByLabelText(/summary/i);
    expect(summary).toHaveAttribute("aria-invalid", "true");
    expect(
      document.getElementById(summary.getAttribute("aria-describedby")!)
    ).toHaveTextContent("Summary is too long");
  });
});
