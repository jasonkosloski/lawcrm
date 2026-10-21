/**
 * Tests for NewMatterForm — validation-error round trip.
 *
 * createMatter echoes ALL submitted fields back via `state.values`
 * on a validation error, and the form's contract (see its header
 * comment) is that nothing typed gets lost. The controlled
 * auto-name inputs only read those echoed values in their
 * `useState` initializers — i.e. on the mount that follows a
 * server-rendered validation error — so these tests inject the
 * error state as the mount state and assert the re-seed.
 *
 * Regression pinned: `location` used to hard-seed to "" and
 * silently dropped the user's typed Case location on round trip.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { CreateMatterState } from "@/lib/new-matter-constants";

// "use server" module that pulls in Prisma/auth — mock it out. The
// form only hands the reference to useActionState; it's never
// invoked in these tests.
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

// Injectable mount state: real useActionState always starts from the
// hardcoded idle initial state, but the post-validation-error render
// (progressive enhancement / server re-render) mounts with the
// action's returned state. Substituting the initial state — and
// nothing else — keeps the hook's real behavior while letting each
// test choose which state the form mounts with.
const mountState = vi.hoisted(() => ({
  current: undefined as CreateMatterState | undefined,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const useActionState = (<State, Payload>(
    action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
    initialState: Awaited<State>,
    permalink?: string
  ) =>
    actual.useActionState(
      action,
      (mountState.current as Awaited<State> | undefined) ?? initialState,
      permalink
    )) as typeof actual.useActionState;
  return { ...actual, useActionState };
});

import {
  NewMatterForm,
  type AreaOption as AreaOptionT,
  type NewMatterFormOptions,
} from "./new-matter-form";

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
      allowedBillingTypes: ["hourly", "flat", "contingent", "court_appointed", "pro_bono"],
      defaultBillingType: "contingent",
      stages: [
        { id: "stage1", name: "Intake", order: 0, isTerminal: false },
      ],
    },
  ],
  clients: [],
  users: [
    { id: "u1", name: "Jason Kosloski", jobTitle: "Attorney", initials: "JK" },
  ],
  currentUserId: "u1",
  canManageTeam: false,
  venues: [
    {
      id: "v1",
      name: "Aurora",
      city: "Aurora",
      county: null,
      state: "CO",
      isActive: true,
    },
  ],
  canAddVenue: false,
  firmState: "CO",
  firmTemplate: "{client_last}, {client_first} - {case_number} - {location}",
  timeZone: "America/Denver",
};

beforeEach(() => {
  mountState.current = undefined;
});

describe("NewMatterForm — fresh mount", () => {
  test("auto-name inputs start empty on the idle state", () => {
    render(<NewMatterForm options={options} />);
    expect(screen.getByPlaceholderText(/search or add a venue/i)).toHaveValue("");
    expect(screen.getByLabelText(/case number/i)).toHaveValue("");
  });

  test("renders Filed date and Trial date inputs in Details", () => {
    render(<NewMatterForm options={options} />);
    const filed = screen.getByLabelText(/filed date/i);
    const trial = screen.getByLabelText(/trial date/i);
    expect(filed).toHaveAttribute("type", "date");
    expect(filed).toHaveAttribute("name", "filedDate");
    expect(trial).toHaveAttribute("type", "date");
    expect(trial).toHaveAttribute("name", "trialDate");
  });

  test("the name hint shows the effective template text", () => {
    render(<NewMatterForm options={options} />);
    expect(
      screen.getByText("{client_last}, {client_first} - {case_number} - {location}")
    ).toBeTruthy();
  });
});

describe("NewMatterForm — validation-error re-seed", () => {
  test("Venue survives the round trip via echoed values", () => {
    mountState.current = {
      status: "error",
      errors: { newClientEmail: ["Email or phone required."] },
      values: { venueId: "v1", caseNumber: "2026-CV-00481" },
    };
    render(<NewMatterForm options={options} />);
    // The regression: venue seeded empty instead of from vals.venueId.
    expect(screen.getByPlaceholderText(/search or add a venue/i)).toHaveValue(
      "Aurora"
    );
    // Sibling controlled input, same contract.
    expect(screen.getByLabelText(/case number/i)).toHaveValue(
      "2026-CV-00481"
    );
  });

  test("a previously-submitted matter name is kept, not auto-overwritten", () => {
    mountState.current = {
      status: "error",
      errors: { newClientEmail: ["Email or phone required."] },
      values: { name: "Alvarez, Maria - Custom Name", venueId: "v1" },
    };
    render(<NewMatterForm options={options} />);
    // vals.name marks the field dirty, so the derived auto name must
    // not replace it even though the auto value ("Aurora") differs.
    expect(screen.getByLabelText(/matter name/i)).toHaveValue(
      "Alvarez, Maria - Custom Name"
    );
  });
});

describe("NewMatterForm — selections survive a validation error (F095)", () => {
  test("billing type and lead keep the user's picks after the server returns an error, and are re-posted", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const { waitFor } = await import("@testing-library/react");
    const { createMatter } = await import("@/app/actions/matters");
    const posted: FormData[] = [];
    vi.mocked(createMatter).mockImplementation(async (_prev, fd) => {
      posted.push(fd);
      return posted.length === 1
        ? {
            status: "error" as const,
            errors: { newClientEmail: ["Add an email or phone"] },
            values: {},
          }
        : { status: "idle" as const };
    });

    const twoUsers: NewMatterFormOptions = {
      ...options,
      users: [
        ...options.users,
        { id: "u2", name: "Eli Active", jobTitle: "Paralegal", initials: "EA" },
      ],
    };
    const user = userEvent.setup();
    render(<NewMatterForm options={twoUsers} />);

    await user.type(
      screen.getByPlaceholderText(/client name/i),
      "Alvarez, Maria"
    );
    await user.selectOptions(screen.getByLabelText(/billing type/i), "hourly");
    await user.selectOptions(screen.getByLabelText(/lead attorney/i), "u2");

    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await waitFor(() => expect(posted).toHaveLength(1));
    await screen.findByText(/add an email or phone/i);

    // The auto-reset used to snap these back to the mount defaults.
    expect(screen.getByLabelText(/billing type/i)).toHaveValue("hourly");
    expect(screen.getByLabelText(/lead attorney/i)).toHaveValue("u2");

    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].get("billingType")).toBe("hourly");
    expect(posted[1].get("leadUserId")).toBe("u2");
  });
});

describe("NewMatterForm — conflict review (ADR-054)", () => {
  const formData = () =>
    new FormData(document.querySelector("form") as HTMLFormElement);

  test("possible conflicts: the tick posts the result's fingerprint", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    mountState.current = {
      status: "error",
      values: {},
      conflict: {
        severity: "warn",
        matches: [{ severity: "warn", description: "Jane Doe — same name" }],
        fingerprint: "fp1",
        canOverride: false,
      },
    };
    render(<NewMatterForm options={options} />);
    expect(screen.getByText("Jane Doe — same name")).toBeInTheDocument();
    expect(formData().get("conflictAck")).toBeNull();
    await userEvent.click(screen.getByLabelText(/reviewed these possible conflicts/i));
    expect(formData().get("conflictAck")).toBe("fp1");
  });

  test("a conflict with the override key asks for a justification", () => {
    mountState.current = {
      status: "error",
      values: { conflictOverrideReason: "ok" },
      errors: { conflictOverrideReason: ["Justification is required (5+ characters)."] },
      conflict: {
        severity: "conflict",
        matches: [{ severity: "conflict", description: "Acme — current client" }],
        fingerprint: "fp2",
        canOverride: true,
      },
    };
    render(<NewMatterForm options={options} />);
    expect(screen.getByLabelText(/override justification/i)).toHaveValue("ok");
    expect(screen.getByText(/5\+ characters/)).toBeInTheDocument();
    expect(formData().get("conflictAck")).toBe("fp2");
  });

  test("a conflict without the override key offers no way through", () => {
    mountState.current = {
      status: "error",
      values: {},
      conflict: {
        severity: "conflict",
        matches: [{ severity: "conflict", description: "Acme — current client" }],
        fingerprint: "fp3",
        canOverride: false,
      },
    };
    render(<NewMatterForm options={options} />);
    expect(screen.queryByLabelText(/override justification/i)).toBeNull();
    expect(formData().get("conflictAck")).toBeNull();
    expect(screen.getByText(/permission to override/i)).toBeInTheDocument();
  });
});

describe("NewMatterForm — extra team members", () => {
  const teamOptions: NewMatterFormOptions = {
    ...options,
    canManageTeam: true,
    users: [
      ...options.users,
      { id: "u2", name: "Pat Para", jobTitle: "Paralegal", initials: "PP" },
    ],
  };

  test("hidden without matters.manage_team", () => {
    render(<NewMatterForm options={options} />);
    expect(screen.queryByText(/other team members/i)).toBeNull();
  });

  test("an added row posts as JSON in extraTeam; the lead is not offered", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<NewMatterForm options={teamOptions} />);
    await userEvent.click(screen.getByRole("button", { name: /add team member/i }));
    const person = screen.getByLabelText("Team member 1");
    // u1 is the lead (current user) — only Pat is offered.
    expect(
      Array.from((person as HTMLSelectElement).options).map((o) => o.value)
    ).toEqual(["", "u2"]);
    await userEvent.selectOptions(person, "u2");
    await userEvent.selectOptions(screen.getByLabelText("Role for team member 1"), "paralegal");
    const fd = new FormData(document.querySelector("form") as HTMLFormElement);
    expect(JSON.parse(fd.get("extraTeam") as string)).toEqual([
      { userId: "u2", role: "paralegal" },
    ]);
  });
});

describe("NewMatterForm — billing type follows the practice area", () => {
  const areaOf = (
    id: string,
    allowed: AreaOptionT["allowedBillingTypes"],
    def: AreaOptionT["defaultBillingType"]
  ): AreaOptionT => ({
    ...options.areas[0],
    id,
    name: `Area ${id}`,
    allowedBillingTypes: allowed,
    defaultBillingType: def,
    stages: [{ id: `${id}-s`, name: "Intake", order: 0, isTerminal: false }],
  });

  test("offers only the area's types, resets on area change", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <NewMatterForm
        options={{
          ...options,
          areas: [
            areaOf("A", ["hourly", "contingent"], "hourly"),
            areaOf("B", ["court_appointed"], "court_appointed"),
          ],
        }}
      />
    );
    const select = () => screen.getByLabelText(/billing type/i);
    const labels = () =>
      Array.from(select().querySelectorAll("option")).map((o) => o.textContent);
    expect(labels()).toEqual(["Hourly", "Contingency"]);
    expect(select()).toHaveValue("hourly");

    await user.selectOptions(screen.getByLabelText(/practice area/i), "B");
    expect(labels()).toEqual(["Court-appointed"]);
    expect(select()).toHaveValue("court_appointed");

    await user.selectOptions(screen.getByLabelText(/practice area/i), "A");
    expect(labels()).toEqual(["Hourly", "Contingency"]);
    expect(select()).toHaveValue("hourly");
  });
});
