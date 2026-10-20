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

import { convertLeadToMatter } from "@/app/actions/leads";
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

describe("ConvertLeadButton — server errors and live props", () => {
  test("a stage error from the server is shown (the select has no inline slot)", async () => {
    const user = userEvent.setup();
    vi.mocked(convertLeadToMatter).mockResolvedValue({
      status: "error",
      errors: { stageId: ["Stage is no longer active"] },
    });
    renderButton();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: /^convert$/i }));
    expect(
      await screen.findByText("Stage is no longer active")
    ).toBeInTheDocument();
  });

  test.each([
    ["practiceAreaId", "Practice area is not available"],
    ["feeStructure", "Invalid fee structure"],
  ] as const)("a %s error from the server is shown", async (field, message) => {
    const user = userEvent.setup();
    vi.mocked(convertLeadToMatter).mockResolvedValue({
      status: "error",
      errors: { [field]: [message] },
    });
    renderButton();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: /^convert$/i }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  test("possible conflicts reveal a review tick that gates the resubmit", async () => {
    const user = userEvent.setup();
    vi.mocked(convertLeadToMatter).mockResolvedValue({
      status: "error",
      conflictWarnings: 2,
    });
    renderButton();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: /^convert$/i }));
    const tick = await screen.findByRole("checkbox", { name: /2 possible conflicts/i });
    expect(screen.getByRole("button", { name: /^convert$/i })).toBeDisabled();

    await user.click(tick);
    await user.click(screen.getByRole("button", { name: /^convert$/i }));
    const fd = vi.mocked(convertLeadToMatter).mock.calls.at(-1)![2] as FormData;
    expect(fd.get("conflictWarningsReviewed")).toBe("true");
  });

  test("a server error keeps what the user typed", async () => {
    const user = userEvent.setup();
    vi.mocked(convertLeadToMatter).mockResolvedValue({
      status: "error",
      errors: { _form: ["Lead is already converted to a matter."] },
    });
    renderButton();
    await openDialog(user);
    const nameInput = screen.getByPlaceholderText("Matter name");
    await user.clear(nameInput);
    await user.type(nameInput, "Edited name");
    await user.selectOptions(
      screen.getByRole("option", { name: "Hourly" }).closest("select")!,
      "hourly"
    );
    await user.click(screen.getByRole("button", { name: /^convert$/i }));
    await screen.findByText("Lead is already converted to a matter.");
    expect(screen.getByPlaceholderText("Matter name")).toHaveValue(
      "Edited name"
    );
    expect(
      (screen.getByRole("option", { name: "Hourly" })
        .closest("select") as HTMLSelectElement).value
    ).toBe("hourly");
  });

  test("a refresh that hands down a new areas array does not wipe an open form", async () => {
    const user = userEvent.setup();
    const { rerender } = renderButton();
    await openDialog(user);
    const nameInput = screen.getByPlaceholderText("Matter name");
    await user.clear(nameInput);
    await user.type(nameInput, "Typed name");
    await user.selectOptions(stageSelect(), "st-closed");

    // Same data, new array identity — what a router refresh produces.
    rerender(
      <ConvertLeadButton
        leadId="lead1"
        defaultMatterName="Doe v. Acme"
        areas={AREAS.map((a) => ({ ...a }))}
      />
    );
    expect(screen.getByPlaceholderText("Matter name")).toHaveValue(
      "Typed name"
    );
    expect(stageSelect().value).toBe("st-closed");
  });

  test("never renders a stage from the previous area after switching area", async () => {
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
    const offered = Array.from(familyStage.options).map((o) => o.value);
    expect(offered).toContain(familyStage.value);
  });
});

describe("ConvertLeadButton — restricted intake (ADR-049)", () => {
  test("a restricted lead says the matter will be restricted to its team", async () => {
    const user = userEvent.setup();
    render(
      <ConvertLeadButton
        leadId="lead1"
        defaultMatterName="Doe v. Acme"
        areas={AREAS}
        restrictedTo={["Alice Attorney", "Bob Paralegal"]}
      />
    );
    await openDialog(user);
    expect(
      screen.getByText(/matter will be restricted to Alice Attorney, Bob Paralegal/i)
    ).toBeTruthy();
  });

  test("an open lead shows no restriction note", async () => {
    const user = userEvent.setup();
    renderButton();
    await openDialog(user);
    expect(screen.queryByText(/will be restricted/i)).toBeNull();
  });
});

describe("ConvertLeadButton — engagement block", () => {
  const DOCS = [
    { id: "d1", name: "retainer-signed.pdf" },
    { id: "d2", name: "intake-notes.pdf" },
  ];
  const LABELLED: PracticeAreaOption[] = [
    { ...AREAS[0], originatingDocLabel: "Retainer agreement" },
    AREAS[1],
  ];

  function renderEngagement(over: {
    required?: boolean;
    areas?: PracticeAreaOption[];
  } = {}) {
    return render(
      <ConvertLeadButton
        leadId="lead1"
        defaultMatterName="Doe v. Acme"
        areas={over.areas ?? LABELLED}
        documents={DOCS}
        requireOriginatingDoc={over.required ?? false}
        todayKey="2026-10-20"
      />
    );
  }

  test("renders the block titled with the picked area's label", async () => {
    const user = userEvent.setup();
    renderEngagement();
    await openDialog(user);
    expect(
      screen.getByRole("heading", { name: "Retainer agreement" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Status/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Date signed/)).toBeInTheDocument();
  });

  test("the label follows the picked area (default Fee agreement)", async () => {
    const user = userEvent.setup();
    renderEngagement();
    await openDialog(user);
    const areaSelect = screen
      .getByRole("option", { name: "Personal Injury" })
      .closest("select") as HTMLSelectElement;
    await user.selectOptions(areaSelect, "pa-fam");
    expect(
      screen.getByRole("heading", { name: "Fee agreement" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("This is the Fee agreement", { exact: false })
    ).toBeInTheDocument();
  });

  test("lists the lead's documents with a None option", async () => {
    const user = userEvent.setup();
    renderEngagement();
    await openDialog(user);
    expect(screen.getByRole("option", { name: "None" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "retainer-signed.pdf" })
    ).toBeInTheDocument();
  });

  test("not required: no markers, and an empty block converts", async () => {
    const user = userEvent.setup();
    vi.mocked(convertLeadToMatter).mockResolvedValue({ status: "error" });
    renderEngagement({ required: false });
    await openDialog(user);
    expect(document.querySelector(".text-warn.ml-0\\.5")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^convert$/i }));
    expect(convertLeadToMatter).toHaveBeenCalledTimes(1);
  });

  test("required: markers show and an incomplete block blocks the submit", async () => {
    const user = userEvent.setup();
    renderEngagement({ required: true });
    await openDialog(user);
    expect(
      document.querySelectorAll(".text-warn.ml-0\\.5").length
    ).toBeGreaterThanOrEqual(3);
    await user.click(screen.getByRole("button", { name: /^convert$/i }));
    expect(convertLeadToMatter).not.toHaveBeenCalled();
    expect(
      screen.getByText("Attach the signed Retainer agreement.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Mark the Retainer agreement as signed.")
    ).toBeInTheDocument();
    expect(screen.getByText("Enter the date it was signed.")).toBeInTheDocument();
  });

  test("posts status, signed date and the picked document", async () => {
    const user = userEvent.setup();
    vi.mocked(convertLeadToMatter).mockResolvedValue({ status: "error" });
    renderEngagement({ required: true });
    await openDialog(user);
    await user.selectOptions(screen.getByLabelText(/^Status/), "signed");
    await user.type(screen.getByLabelText(/^Date signed/), "2026-10-01");
    await user.selectOptions(
      screen.getByRole("option", { name: "retainer-signed.pdf" }).closest("select")!,
      "d1"
    );
    await user.click(screen.getByRole("button", { name: /^convert$/i }));
    const fd = vi.mocked(convertLeadToMatter).mock.calls.at(-1)![2] as FormData;
    expect(fd.get("agreementStatus")).toBe("signed");
    expect(fd.get("agreementSignedDate")).toBe("2026-10-01");
    expect(fd.get("originatingDocumentId")).toBe("d1");
  });

  test("shows server field errors under originatingDocumentId", async () => {
    const user = userEvent.setup();
    vi.mocked(convertLeadToMatter).mockResolvedValue({
      status: "error",
      errors: { originatingDocumentId: ["Attach the signed Retainer agreement."] },
    });
    renderEngagement({ required: false });
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: /^convert$/i }));
    expect(
      await screen.findByText("Attach the signed Retainer agreement.")
    ).toBeInTheDocument();
  });
});
