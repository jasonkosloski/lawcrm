/**
 * Tests for ConflictCheckCard.
 *
 * What's worth pinning down:
 *   - Status pill maps to the right label per status.
 *   - Run button only renders when canRun=true.
 *   - Override workflow opens a composer; rejects justifications
 *     under 5 chars; calls the action on submit.
 *   - Saved override rationale renders read-only when status is
 *     already "override".
 *   - Matches list renders with deep-link anchors.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/conflict-check", () => ({
  runLeadConflictCheck: vi.fn(),
  overrideLeadConflictCheck: vi.fn(),
}));

import {
  overrideLeadConflictCheck,
  runLeadConflictCheck,
} from "@/app/actions/conflict-check";
import { ConflictCheckCard } from "./conflict-check-card";

const mockedRun = vi.mocked(runLeadConflictCheck);
const mockedOverride = vi.mocked(overrideLeadConflictCheck);

const NO_MATCHES: Parameters<typeof ConflictCheckCard>[0]["matches"] = [];

beforeEach(() => {
  mockedRun.mockReset();
  mockedRun.mockResolvedValue({ ok: true, severity: "clear" });
  mockedOverride.mockReset();
  mockedOverride.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConflictCheckCard — status pill mapping", () => {
  test.each([
    ["pending", "Not run yet"],
    ["clear", "Clear"],
    ["warn", "Possible conflict"],
    ["conflict", "Direct conflict"],
    ["override", "Cleared (override)"],
  ] as const)("status %s renders label '%s'", (status, label) => {
    render(
      <ConflictCheckCard
        leadId="lead1"
        status={status}
        checkedAt={null}
        resolutionNotes={null}
        matches={NO_MATCHES}
        canRun={false}
        canOverride={false}
      />
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("ConflictCheckCard — Run button visibility", () => {
  test("hidden when canRun=false", () => {
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="pending"
        checkedAt={null}
        resolutionNotes={null}
        matches={NO_MATCHES}
        canRun={false}
        canOverride={false}
      />
    );
    expect(
      screen.queryByRole("button", { name: /run conflict check/i })
    ).not.toBeInTheDocument();
  });

  test("'Run conflict check' renders on first-load (no checkedAt)", () => {
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="pending"
        checkedAt={null}
        resolutionNotes={null}
        matches={NO_MATCHES}
        canRun
        canOverride={false}
      />
    );
    expect(
      screen.getByRole("button", { name: /run conflict check/i })
    ).toBeInTheDocument();
  });

  test("'Re-run' label when checkedAt is already set", () => {
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="clear"
        checkedAt={new Date("2026-04-25T12:00:00Z")}
        resolutionNotes={null}
        matches={NO_MATCHES}
        canRun
        canOverride={false}
      />
    );
    expect(screen.getByRole("button", { name: /re-run/i })).toBeInTheDocument();
  });

  test("clicking Run calls the action with the lead id", async () => {
    const user = userEvent.setup();
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="pending"
        checkedAt={null}
        resolutionNotes={null}
        matches={NO_MATCHES}
        canRun
        canOverride={false}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /run conflict check/i })
    );
    expect(mockedRun).toHaveBeenCalledTimes(1);
    expect(mockedRun).toHaveBeenCalledWith("lead1");
  });
});

describe("ConflictCheckCard — Override workflow", () => {
  test("Override button hidden unless canOverride AND status is warn|conflict", () => {
    // Cleared status doesn't get an override path.
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="clear"
        checkedAt={null}
        resolutionNotes={null}
        matches={NO_MATCHES}
        canRun
        canOverride
      />
    );
    expect(
      screen.queryByRole("button", { name: /^override/i })
    ).not.toBeInTheDocument();
  });

  test("warn status + canOverride shows the Override button", () => {
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="warn"
        checkedAt={null}
        resolutionNotes={null}
        matches={[
          {
            kind: "contact_name",
            severity: "warn",
            matchedField: "name",
            description: "Same name in directory",
          },
        ]}
        canRun
        canOverride
      />
    );
    expect(
      screen.getByRole("button", { name: /^override/i })
    ).toBeInTheDocument();
  });

  test("clicking Override opens the textarea composer", async () => {
    const user = userEvent.setup();
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="conflict"
        checkedAt={null}
        resolutionNotes={null}
        matches={[
          {
            kind: "contact_email",
            severity: "conflict",
            matchedField: "email",
            description: "Same email on opposing side",
          },
        ]}
        canRun
        canOverride
      />
    );
    await user.click(screen.getByRole("button", { name: /^override/i }));
    expect(
      screen.getByPlaceholderText(/justification/i)
    ).toBeInTheDocument();
  });

  test("Override + clear is disabled until 5+ characters typed", async () => {
    const user = userEvent.setup();
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="warn"
        checkedAt={null}
        resolutionNotes={null}
        matches={[
          {
            kind: "contact_name",
            severity: "warn",
            matchedField: "name",
            description: "Match",
          },
        ]}
        canRun
        canOverride
      />
    );
    await user.click(screen.getByRole("button", { name: /^override/i }));
    const submitBtn = screen.getByRole("button", {
      name: /override \+ clear/i,
    });
    expect(submitBtn).toBeDisabled();
    await user.type(
      screen.getByPlaceholderText(/justification/i),
      "five!"
    );
    expect(submitBtn).toBeEnabled();
  });

  test("Override submission calls the action with FormData containing the notes", async () => {
    const user = userEvent.setup();
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="warn"
        checkedAt={null}
        resolutionNotes={null}
        matches={[
          {
            kind: "contact_name",
            severity: "warn",
            matchedField: "name",
            description: "Match",
          },
        ]}
        canRun
        canOverride
      />
    );
    await user.click(screen.getByRole("button", { name: /^override/i }));
    await user.type(
      screen.getByPlaceholderText(/justification/i),
      "former client, no substantial relationship"
    );
    await user.click(
      screen.getByRole("button", { name: /override \+ clear/i })
    );

    expect(mockedOverride).toHaveBeenCalledTimes(1);
    const [leadId, fd] = mockedOverride.mock.calls[0]!;
    expect(leadId).toBe("lead1");
    expect(fd.get("notes")).toBe(
      "former client, no substantial relationship"
    );
  });

  test("server error reverts the override flow", async () => {
    mockedOverride.mockResolvedValueOnce({
      ok: false,
      error: "Override only applies to flagged leads.",
    });
    const user = userEvent.setup();
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="warn"
        checkedAt={null}
        resolutionNotes={null}
        matches={[
          {
            kind: "contact_name",
            severity: "warn",
            matchedField: "name",
            description: "Match",
          },
        ]}
        canRun
        canOverride
      />
    );
    await user.click(screen.getByRole("button", { name: /^override/i }));
    await user.type(
      screen.getByPlaceholderText(/justification/i),
      "valid justification"
    );
    await user.click(
      screen.getByRole("button", { name: /override \+ clear/i })
    );
    expect(
      await screen.findByText(/Override only applies/)
    ).toBeInTheDocument();
  });

  test("saved override rationale renders read-only when status='override'", () => {
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="override"
        checkedAt={new Date("2026-04-25")}
        resolutionNotes="Informed-consent waiver signed."
        matches={[]}
        canRun
        canOverride
      />
    );
    expect(screen.getByText(/Override rationale/)).toBeInTheDocument();
    expect(
      screen.getByText("Informed-consent waiver signed.")
    ).toBeInTheDocument();
  });
});

describe("ConflictCheckCard — matches list", () => {
  test("each match renders with severity chip + description", () => {
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="conflict"
        checkedAt={null}
        resolutionNotes={null}
        matches={[
          {
            kind: "contact_email",
            severity: "conflict",
            matchedField: "email",
            description: "John Doe — same email on opposing side",
            contactId: "c1",
          },
          {
            kind: "contact_name",
            severity: "warn",
            matchedField: "name",
            description: "Jane Doe — same name in directory",
            contactId: "c2",
          },
        ]}
        canRun
        canOverride={false}
      />
    );
    expect(screen.getByText("Conflict")).toBeInTheDocument();
    expect(screen.getByText("Warn")).toBeInTheDocument();
    expect(
      screen.getByText("John Doe — same email on opposing side")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Jane Doe — same name in directory")
    ).toBeInTheDocument();
  });

  test("contact deep-link renders when contactId is present", () => {
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="warn"
        checkedAt={null}
        resolutionNotes={null}
        matches={[
          {
            kind: "contact_name",
            severity: "warn",
            matchedField: "name",
            description: "Same name",
            contactId: "c123",
          },
        ]}
        canRun={false}
        canOverride={false}
      />
    );
    const link = screen.getByRole("link", { name: /Contact/ });
    expect(link).toHaveAttribute("href", "/contacts/c123");
  });

  test("matter deep-link renders when matterId is present", () => {
    render(
      <ConflictCheckCard
        leadId="lead1"
        status="conflict"
        checkedAt={null}
        resolutionNotes={null}
        matches={[
          {
            kind: "matter_opposing_party",
            severity: "conflict",
            matchedField: "name",
            description: "Match against opposing party on Matter X",
            matterId: "m456",
          },
        ]}
        canRun={false}
        canOverride={false}
      />
    );
    const link = screen.getByRole("link", { name: /Matter/ });
    expect(link).toHaveAttribute("href", "/matters/m456");
  });
});
