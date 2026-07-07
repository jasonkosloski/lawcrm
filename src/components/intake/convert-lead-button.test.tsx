/**
 * Tests for ConvertLeadButton.
 *
 * What's worth pinning down:
 *   - The stage default skips terminal stages ("Closed" is never the
 *     starting point for a fresh matter).
 *   - Cancel + reopen resets EVERY field — including stageId, which
 *     regressed once because the area-sync effect only fires when the
 *     area actually changes (stale terminal stage survived the reopen).
 *   - Switching practice area snaps the stage to the new area's first
 *     non-terminal stage.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/leads", () => ({
  convertLeadToMatter: vi.fn(),
}));

import { ConvertLeadButton } from "./convert-lead-button";
import type { PracticeAreaOption } from "@/lib/queries/practice-area-options";

// "Closed" deliberately sorts first so the tests catch any default that
// naively grabs stages[0] instead of the first non-terminal stage.
const AREAS: PracticeAreaOption[] = [
  {
    id: "pa-pi",
    name: "Personal Injury",
    stages: [
      { id: "st-closed", name: "Closed", isTerminal: true, order: 0 },
      { id: "st-intake", name: "Intake", isTerminal: false, order: 1 },
      { id: "st-lit", name: "Litigation", isTerminal: false, order: 2 },
    ],
  },
  {
    id: "pa-fam",
    name: "Family",
    stages: [
      { id: "st-consult", name: "Consultation", isTerminal: false, order: 0 },
      { id: "st-done", name: "Resolved", isTerminal: true, order: 1 },
    ],
  },
];

function renderButton() {
  return render(
    <ConvertLeadButton
      leadId="lead1"
      defaultMatterName="Doe v. Acme"
      areas={AREAS}
    />
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /convert to matter/i }));
}

/** The stage <select> is the one offering the PI stage options. */
function stageSelect() {
  return screen.getByRole("option", { name: "Intake" })
    .closest("select") as HTMLSelectElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConvertLeadButton — stage defaults", () => {
  test("opening the dialog defaults to the first NON-terminal stage", async () => {
    const user = userEvent.setup();
    renderButton();
    await openDialog(user);
    // "Closed" is stages[0] but terminal — Intake must win.
    expect(stageSelect().value).toBe("st-intake");
  });

  test("switching practice area snaps stage to the new area's first non-terminal stage", async () => {
    const user = userEvent.setup();
    renderButton();
    await openDialog(user);
    const areaSelect = screen
      .getByRole("option", { name: "Personal Injury" })
      .closest("select") as HTMLSelectElement;
    await user.selectOptions(areaSelect, "pa-fam");
    const familyStage = screen
      .getByRole("option", { name: "Consultation" })
      .closest("select") as HTMLSelectElement;
    expect(familyStage.value).toBe("st-consult");
  });
});

describe("ConvertLeadButton — cancel + reopen reset", () => {
  test("a stage picked before Cancel does not survive the reopen", async () => {
    const user = userEvent.setup();
    renderButton();

    await openDialog(user);
    // Change ONLY the stage (area stays areas[0], so the area-sync
    // effect won't fire on reopen — the reset effect must handle it).
    await user.selectOptions(stageSelect(), "st-closed");
    expect(stageSelect().value).toBe("st-closed");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await openDialog(user);
    expect(stageSelect().value).toBe("st-intake");
  });

  test("name and fee structure also reset on reopen", async () => {
    const user = userEvent.setup();
    renderButton();

    await openDialog(user);
    const nameInput = screen.getByPlaceholderText("Matter name");
    await user.clear(nameInput);
    await user.type(nameInput, "Edited name");
    await user.selectOptions(
      screen.getByRole("option", { name: "Hourly" }).closest("select")!,
      "hourly"
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await openDialog(user);
    expect(screen.getByPlaceholderText("Matter name")).toHaveValue(
      "Doe v. Acme"
    );
    expect(
      (screen.getByRole("option", { name: "Hourly" })
        .closest("select") as HTMLSelectElement).value
    ).toBe("contingent");
  });
});
