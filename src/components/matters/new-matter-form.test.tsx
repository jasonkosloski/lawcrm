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
  type NewMatterFormOptions,
} from "./new-matter-form";

const options: NewMatterFormOptions = {
  areas: [
    {
      id: "area1",
      name: "Civil Rights",
      hasStatuteOfLimitations: false,
      statutePeriodDays: null,
      statuteSourceCitation: null,
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
};

beforeEach(() => {
  mountState.current = undefined;
});

describe("NewMatterForm — fresh mount", () => {
  test("auto-name inputs start empty on the idle state", () => {
    render(<NewMatterForm options={options} />);
    expect(screen.getByLabelText(/case location/i)).toHaveValue("");
    expect(screen.getByLabelText(/case number/i)).toHaveValue("");
  });
});

describe("NewMatterForm — validation-error re-seed", () => {
  test("Case location survives the round trip via echoed values", () => {
    mountState.current = {
      status: "error",
      errors: { newClientEmail: ["Email or phone required."] },
      values: { location: "Aurora", caseNumber: "2026-CV-00481" },
    };
    render(<NewMatterForm options={options} />);
    // The regression: location seeded from "" instead of vals.location.
    expect(screen.getByLabelText(/case location/i)).toHaveValue("Aurora");
    // Sibling controlled input, same contract.
    expect(screen.getByLabelText(/case number/i)).toHaveValue(
      "2026-CV-00481"
    );
  });

  test("a previously-submitted matter name is kept, not auto-overwritten", () => {
    mountState.current = {
      status: "error",
      errors: { newClientEmail: ["Email or phone required."] },
      values: { name: "Alvarez, Maria - Custom Name", location: "Aurora" },
    };
    render(<NewMatterForm options={options} />);
    // vals.name marks the field dirty, so the auto-name effect must
    // not blow it away even though the auto value ("Aurora") differs.
    expect(screen.getByLabelText(/matter name/i)).toHaveValue(
      "Alvarez, Maria - Custom Name"
    );
  });
});
