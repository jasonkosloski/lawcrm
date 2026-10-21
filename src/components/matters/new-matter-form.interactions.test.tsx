/**
 * NewMatterForm — interaction tests (JS submit path).
 *
 * The sibling new-matter-form.test.tsx pins the no-JS remount path; this
 * file drives a real useActionState with a mocked action: auto-name
 * derivation, the client typeahead (unlink, keyboard), the area -> stage
 * cascade through an error + resubmit, and field-error accessibility.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Draft save/auto-save and the Engagement section pull these in; the
// tests here never exercise them.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/app/actions/matter-drafts", () => ({
  saveMatterDraft: vi.fn(),
  removeDraftFile: vi.fn(),
  setDraftFileOriginating: vi.fn(),
  deleteMatterDraft: vi.fn(),
}));

vi.mock("@/app/actions/matters", () => ({
  createMatter: vi.fn(),
}));

import { createMatter } from "@/app/actions/matters";
import {
  NewMatterForm,
  type NewMatterFormOptions,
} from "./new-matter-form";

import type { BillingType } from "@/lib/billing-type";
const ALL_BT: BillingType[] = ["hourly", "flat", "contingent", "court_appointed", "pro_bono"];

const mockedAction = vi.mocked(createMatter);

const options: NewMatterFormOptions = {
  areas: [
    {
      id: "area1",
      name: "Civil Rights",
      hasStatuteOfLimitations: false,
      statutePeriod: null,
      statuteSourceCitation: null,
      matterNameTemplate: null,
      requiredMatterFields: [],
      allowedBillingTypes: ALL_BT,
      defaultBillingType: "contingent" as const,
      stages: [{ id: "stage1", name: "Intake", order: 0, isTerminal: false }],
    },
    {
      id: "area2",
      name: "Employment",
      hasStatuteOfLimitations: true,
      statutePeriod: { amount: 1, unit: "YEARS" as const },
      statuteSourceCitation: null,
      matterNameTemplate: "State v. {client_last}",
      requiredMatterFields: [],
      allowedBillingTypes: ALL_BT,
      defaultBillingType: "contingent" as const,
      stages: [
        { id: "stage2a", name: "Screening", order: 0, isTerminal: false },
        { id: "stage2b", name: "Demand", order: 1, isTerminal: false },
      ],
    },
    {
      id: "area3",
      name: "Criminal Defense",
      hasStatuteOfLimitations: false,
      statutePeriod: null,
      statuteSourceCitation: null,
      matterNameTemplate: null,
      requiredMatterFields: ["caseNumber", "venue"],
      allowedBillingTypes: ALL_BT,
      defaultBillingType: "contingent" as const,
      stages: [{ id: "stage3", name: "Arraignment", order: 0, isTerminal: false }],
    },
  ],
  clients: [
    { id: "c1", name: "Maria Alvarez", organization: null, city: "Aurora" },
    { id: "c2", name: "Maria Lopez", organization: null, city: null },
    {
      id: "c3",
      name: "Colorado Freedom Fund",
      organization: "Colorado Freedom Fund",
      city: null,
    },
  ],
  users: [
    { id: "u1", name: "Jason Kosloski", jobTitle: "Attorney", initials: "JK" },
  ],
  currentUserId: "u1",
  canManageTeam: false,
  venues: [
    {
      id: "v1",
      name: "Denver District Court",
      city: "Denver",
      county: "Denver",
      state: "CO",
      isActive: true,
    },
  ],
  canAddVenue: false,
  firmState: "CO",
  firmTemplate: "{client_last}, {client_first} - {case_number} - {location}",
  timeZone: "America/Denver",
};

const hiddenClientId = () =>
  (document.querySelector('input[name="clientId"]') as HTMLInputElement).value;

beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockResolvedValue({ status: "idle" });
});

describe("NewMatterForm — auto name", () => {
  test("derives the name from client + case number + venue as the user types, with an auto badge", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} />);

    await user.type(screen.getByPlaceholderText(/client name/i), "Zed Newperson");
    await user.type(screen.getByLabelText(/case number/i), "2026-CV-1");
    await user.click(screen.getByPlaceholderText(/search or add a venue/i));
    await user.click(screen.getByText(/Denver District Court/));
    expect(screen.getByLabelText(/matter name/i)).toHaveValue(
      "Newperson, Zed - 2026-CV-1 - Denver District Court"
    );
    expect(screen.getByText("auto")).toBeTruthy();

    // Typing in the name takes ownership; later edits don't overwrite it.
    await user.type(screen.getByLabelText(/matter name/i), "!");
    await user.type(screen.getByLabelText(/case number/i), "x");
    expect(screen.getByLabelText(/matter name/i)).toHaveValue(
      "Newperson, Zed - 2026-CV-1 - Denver District Court!"
    );
    // Reset to auto recomputes from the current fields.
    await user.click(screen.getByRole("button", { name: /reset to auto/i }));
    expect(screen.getByLabelText(/matter name/i)).toHaveValue(
      "Newperson, Zed - 2026-CV-1x - Denver District Court"
    );
  });

  test("an area template drives the name; switching areas follows the effective template until edited", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} />);
    await user.type(screen.getByPlaceholderText(/client name/i), "Maria Alvarez");
    const name = screen.getByLabelText(/matter name/i);
    expect(name).toHaveValue("Alvarez, Maria");

    await user.selectOptions(screen.getByLabelText(/practice area/i), "area2");
    expect(name).toHaveValue("State v. Alvarez");
    expect(screen.getByText("State v. {client_last}")).toBeTruthy();

    // Null template -> the firm default again.
    await user.selectOptions(screen.getByLabelText(/practice area/i), "area1");
    expect(name).toHaveValue("Alvarez, Maria");

    // A manual edit is left alone when the area changes.
    await user.selectOptions(screen.getByLabelText(/practice area/i), "area2");
    await user.type(name, "!");
    await user.selectOptions(screen.getByLabelText(/practice area/i), "area1");
    expect(name).toHaveValue("State v. Alvarez!");
    await user.click(screen.getByRole("button", { name: /reset to auto/i }));
    expect(name).toHaveValue("Alvarez, Maria");
  });

  test("a picked organization contact is not inverted", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} />);
    await user.type(screen.getByPlaceholderText(/client name/i), "Colorado");
    await user.click(
      screen.getByRole("option", { name: /colorado freedom fund/i })
    );
    expect(screen.getByLabelText(/matter name/i)).toHaveValue(
      "Colorado Freedom Fund"
    );
  });
});

describe("NewMatterForm — client picker", () => {
  test("unlinking clears the name (no accidental duplicate client) and refocuses the input", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} />);

    await user.type(screen.getByPlaceholderText(/client name/i), "Alvarez");
    await user.click(screen.getByRole("option", { name: /maria alvarez/i }));
    expect(hiddenClientId()).toBe("c1");

    await user.click(screen.getByRole("button", { name: /unlink client/i }));
    const input = screen.getByPlaceholderText(/client name/i);
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    // Nothing typed -> no client at all, not a "create new" sentinel.
    expect(hiddenClientId()).toBe("");
  });

  test("keyboard: arrows highlight, Enter picks without submitting, Escape closes", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} />);

    const input = screen.getByPlaceholderText(/client name/i);
    await user.type(input, "Maria");
    expect(input).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(
      screen.getByRole("option", { name: /maria lopez/i })
    ).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(mockedAction).not.toHaveBeenCalled();
    expect(hiddenClientId()).toBe("c2");

    // Escape closes the list without picking.
    await user.click(screen.getByRole("button", { name: /unlink client/i }));
    await user.type(screen.getByPlaceholderText(/client name/i), "Maria");
    await user.keyboard("{Escape}");
    expect(screen.getByPlaceholderText(/client name/i)).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("Enter with the list open and nothing highlighted does not submit a new client", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} />);
    await user.type(screen.getByPlaceholderText(/client name/i), "Maria{Enter}");
    expect(mockedAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("NewMatterForm — area/stage cascade and resubmit", () => {
  test("changing the area snaps the stage; a corrected resubmit posts the user's area + stage", async () => {
    const posted: FormData[] = [];
    mockedAction.mockImplementation(async (_prev, fd) => {
      posted.push(fd);
      return posted.length === 1
        ? {
            status: "error" as const,
            errors: { newClientEmail: ["Add an email or phone"] },
            values: {},
          }
        : { status: "idle" as const };
    });
    const user = userEvent.setup();
    render(<NewMatterForm options={options} />);

    await user.type(screen.getByPlaceholderText(/client name/i), "Zed Newperson");
    await user.selectOptions(screen.getByLabelText(/practice area/i), "area2");
    expect(screen.getByLabelText(/^stage/i)).toHaveValue("stage2a");
    await user.selectOptions(screen.getByLabelText(/^stage/i), "stage2b");
    // The SOL section appears for the SOL-tracking area.
    await user.type(screen.getByLabelText(/incident/i), "2026-01-15");

    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await waitFor(() => expect(posted).toHaveLength(1));
    await screen.findByText(/add an email or phone/i);

    // React 19's automatic form reset used to snap these back.
    expect(screen.getByLabelText(/practice area/i)).toHaveValue("area2");
    expect(screen.getByLabelText(/^stage/i)).toHaveValue("stage2b");

    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].get("practiceAreaId")).toBe("area2");
    expect(posted[1].get("stageId")).toBe("stage2b");
    expect(posted[1].get("incidentDate")).toBe("2026-01-15");
  });
});

describe("NewMatterForm — accessibility", () => {
  test("a field error is announced: aria-invalid + aria-describedby the error text", async () => {
    mockedAction.mockResolvedValue({
      status: "error",
      errors: { caseNumber: ["Case number already in use."] },
      values: { caseNumber: "2026-CV-1" },
    });
    const user = userEvent.setup();
    render(<NewMatterForm options={options} />);
    await user.type(screen.getByPlaceholderText(/client name/i), "Zed Newperson");
    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await screen.findByText("Case number already in use.");

    const input = screen.getByLabelText(/case number/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveTextContent(
      "Case number already in use."
    );
    // A field without an error is not marked invalid.
    expect(screen.getByLabelText(/court/i)).not.toHaveAttribute(
      "aria-invalid"
    );
  });
});

describe("NewMatterForm — per-area required fields", () => {
  test("a required area marks fields and blocks an empty submit client-side", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} />);
    await user.selectOptions(screen.getByLabelText(/practice area/i), "area3");
    await user.type(screen.getByPlaceholderText(/client name/i), "Zed Newperson");

    expect(screen.getAllByText("Required for Criminal Defense")).toHaveLength(2);
    expect(screen.getByLabelText(/case number/i).closest("div")).toHaveTextContent("*");

    await user.click(screen.getByRole("button", { name: /create matter/i }));
    expect(mockedAction).not.toHaveBeenCalled();
    expect(
      screen.getAllByText("Required for this practice area.")
    ).toHaveLength(2);
    expect(screen.getByLabelText(/case number/i)).toHaveFocus();

    // Filling both lets it through.
    await user.type(screen.getByLabelText(/case number/i), "2026-CR-1");
    await user.click(screen.getByPlaceholderText(/search or add a venue/i));
    await user.click(screen.getByText(/Denver District Court/));
    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledTimes(1));
  });

  test("focus goes to the first missing field in DOM order, not key order", async () => {
    const user = userEvent.setup();
    const area = (id: string, fields: string[]) => ({
      ...options.areas[0],
      id,
      name: `Area ${id}`,
      requiredMatterFields: fields,
      allowedBillingTypes: ALL_BT,
      defaultBillingType: "contingent" as const,
      stages: [{ id: `s-${id}`, name: "Intake", order: 0, isTerminal: false }],
    });
    render(
      <NewMatterForm
        options={{
          ...options,
          areas: [area("a", ["client", "caseNumber"]), area("b", ["client", "opposingParty"])],
        }}
      />
    );
    // Matter name is natively required; fill it so the JS check runs.
    await user.type(screen.getByLabelText(/matter name/i), "Test matter");
    // client is listed first, but case number comes first in the DOM.
    await user.click(screen.getByRole("button", { name: /create matter/i }));
    expect(mockedAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/case number/i)).toHaveFocus();

    // Here the client picker input is the earliest missing field.
    await user.selectOptions(screen.getByLabelText(/practice area/i), "b");
    await user.click(screen.getByRole("button", { name: /create matter/i }));
    expect(screen.getByPlaceholderText(/client name/i)).toHaveFocus();
  });
});
