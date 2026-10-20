import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/matter-drafts", () => ({
  removeDraftFile: vi.fn(async () => ({ ok: true })),
  setDraftFileOriginating: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/components/matters/documents/multi-file-upload", () => ({
  MultiFileUpload: ({ scope }: { scope: { kind: string; draftId: string | null } }) => (
    <button type="button" data-testid="uploader" data-draft={String(scope.draftId)}>
      Upload files
    </button>
  ),
}));

import { removeDraftFile, setDraftFileOriginating } from "@/app/actions/matter-drafts";
import { EngagementSection } from "./engagement-section";

const files = [
  { id: "f1", name: "retainer.pdf", isOriginating: true },
  { id: "f2", name: "id.pdf", isOriginating: false },
];

function renderSection(over: Partial<React.ComponentProps<typeof EngagementSection>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <EngagementSection
      label="Fee agreement"
      required={false}
      canUpload
      draftId="d1"
      draftUpdatedAt="2026-10-20T10:00:00.000Z"
      ensureDraft={async () => "d1"}
      files={files}
      status="not_sent"
      signedDate=""
      originatingFileId="f1"
      onChange={onChange}
      {...over}
    />
  );
  return { ...utils, onChange };
}

const hidden = (name: string) =>
  (document.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement).value;

beforeEach(() => vi.clearAllMocks());

describe("EngagementSection", () => {
  test("titled with the area's label, with the status, date and hidden fields posted", () => {
    renderSection({ label: "Retainer" });
    expect(screen.getByRole("heading", { name: "Retainer" })).toBeTruthy();
    expect(hidden("draftId")).toBe("d1");
    expect(hidden("draftUpdatedAt")).toBe("2026-10-20T10:00:00.000Z");
    expect(hidden("originatingFileId")).toBe("f1");
    expect(screen.getByLabelText(/^status/i)).toHaveValue("not_sent");
    expect(screen.getByLabelText(/date signed/i)).toBeTruthy();
  });

  test("required (switch on): status, date and files are marked required", () => {
    renderSection({ required: true });
    for (const name of [/^status/i, /date signed/i]) {
      expect(screen.getByText(name, { selector: "label" }).textContent).toContain("*");
    }
    expect(screen.getByText("Files").textContent).toContain("*");
  });

  test("not required: no required markers", () => {
    renderSection({ required: false });
    expect(document.body.textContent).not.toContain("*");
  });

  test("no documents.upload: the explanation replaces the upload button (Review Focus 3)", () => {
    renderSection({ canUpload: false, label: "Retainer" });
    expect(
      screen.getByText("You need permission to upload documents to attach the Retainer.")
    ).toBeTruthy();
    expect(screen.queryByTestId("uploader")).toBeNull();
  });

  test("with permission the uploader targets the draft (null before one exists)", () => {
    renderSection({ draftId: null, draftUpdatedAt: null });
    expect(screen.getByTestId("uploader").getAttribute("data-draft")).toBe("null");
  });

  test("marking a file calls the action then reports the change", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSection();
    await user.click(screen.getAllByLabelText(/this is the fee agreement/i)[1]);
    expect(setDraftFileOriginating).toHaveBeenCalledWith("f2");
    expect(onChange).toHaveBeenCalledWith({ originatingFileId: "f2" });
  });

  test("marking a file that fails (rejects or ok:false) shows a small error", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSection();
    vi.mocked(setDraftFileOriginating).mockRejectedValueOnce(new Error("boom"));
    await user.click(screen.getAllByLabelText(/this is the fee agreement/i)[1]);
    expect(screen.getByText(/couldn't mark that file/i)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("removing a file calls the action then reports it; a failure shows an error", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSection();
    await user.click(screen.getByRole("button", { name: "Remove id.pdf" }));
    expect(removeDraftFile).toHaveBeenCalledWith("f2");
    expect(onChange).toHaveBeenCalledWith({ removedFileId: "f2" });

    vi.mocked(removeDraftFile).mockResolvedValueOnce({ ok: false });
    await user.click(screen.getByRole("button", { name: "Remove retainer.pdf" }));
    expect(screen.getByText(/couldn't remove that file/i)).toBeTruthy();
  });

  test("shows the gate errors under their controls", () => {
    renderSection({
      required: true,
      errors: {
        originatingFileId: ["Attach the signed Fee agreement."],
        agreementStatus: ["Mark the Fee agreement as signed."],
        agreementSignedDate: ["Enter the date it was signed."],
      },
    });
    expect(screen.getByText("Attach the signed Fee agreement.")).toBeTruthy();
    expect(screen.getByText("Mark the Fee agreement as signed.")).toBeTruthy();
    expect(screen.getByText("Enter the date it was signed.")).toBeTruthy();
  });
});
