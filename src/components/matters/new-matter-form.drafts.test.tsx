/**
 * NewMatterForm - drafts: Save draft, auto-save, stale/gone copy, the
 * Engagement section, and the client-side originating-document gate.
 * Pins plan Review Focus 1, 2, 3 and 5 at the form level.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/actions/matters", () => ({ createMatter: vi.fn() }));
vi.mock("@/app/actions/matter-drafts", () => ({
  saveMatterDraft: vi.fn(),
  removeDraftFile: vi.fn(async () => ({ ok: true })),
  setDraftFileOriginating: vi.fn(async () => ({ ok: true })),
  deleteMatterDraft: vi.fn(),
}));
vi.mock("@/components/matters/documents/multi-file-upload", () => ({
  MultiFileUpload: () => <button type="button">Upload files</button>,
}));

import { createMatter } from "@/app/actions/matters";
import { saveMatterDraft } from "@/app/actions/matter-drafts";
import {
  NewMatterForm,
  type NewMatterDraft,
  type NewMatterEngagement,
  type NewMatterFormOptions,
} from "./new-matter-form";

import type { BillingType } from "@/lib/billing-type";
const ALL_BT: BillingType[] = ["hourly", "flat", "contingent", "court_appointed", "pro_bono"];

const create = vi.mocked(createMatter);
const save = vi.mocked(saveMatterDraft);

const area = (id: string, name: string) => ({
  id,
  name,
  hasStatuteOfLimitations: false,
  statutePeriod: null,
  statuteSourceCitation: null,
  matterNameTemplate: null,
  requiredMatterFields: [],
  allowedBillingTypes: ALL_BT,
  defaultBillingType: "contingent" as const,
  stages: [{ id: `${id}-s`, name: "Intake", order: 0, isTerminal: false }],
});

const options: NewMatterFormOptions = {
  areas: [area("a1", "Personal Injury"), area("a2", "Criminal Defense")],
  clients: [],
  users: [{ id: "u1", name: "Jason K", jobTitle: "Attorney", initials: "JK" }],
  leadUsers: [{ id: "u1", name: "Jason K", jobTitle: "Attorney", initials: "JK" }],
  currentUserId: "u1",
  canManageTeam: false,
  venues: [],
  canAddVenue: false,
  firmState: "CO",
  firmTemplate: "{client_last}",
  timeZone: "America/Denver",
};

const engagement = (over: Partial<NewMatterEngagement> = {}): NewMatterEngagement => ({
  required: false,
  canUpload: true,
  labelsByArea: { a1: "Fee agreement", a2: "Retainer" },
  defaultLabel: "Fee agreement",
  todayKey: "2026-10-20",
  ...over,
});

const T1 = "2026-10-20T10:00:00.000Z";
const draft = (over: Partial<NewMatterDraft> = {}): NewMatterDraft => ({
  id: "d1",
  updatedAt: T1,
  values: { newClientName: "Maria Alvarez", practiceAreaId: "a1", name: "Alvarez, Maria" },
  files: [
    { id: "f1", name: "retainer.pdf", isOriginating: true },
    { id: "f2", name: "id.pdf", isOriginating: false },
  ],
  ...over,
});

const hidden = (name: string) =>
  (document.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement).value;

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ status: "idle" });
});
afterEach(() => vi.useRealTimers());

describe("NewMatterForm - Save draft", () => {
  test("the first save creates the draft and replaces the URL with ?draft=<id>", async () => {
    save.mockResolvedValue({ ok: true, draftId: "new1", updatedAt: T1 });
    const user = userEvent.setup();
    render(<NewMatterForm options={options} engagement={engagement()} />);
    await user.type(screen.getByPlaceholderText(/client name/i), "Zed Newperson");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/matters/new?draft=new1"));
    const [id, expected, values] = save.mock.calls[0];
    expect(id).toBeNull();
    expect(expected).toBeNull();
    expect(values.newClientName).toBe("Zed Newperson");
    // The draft machinery's own hidden fields are not draft content.
    expect(values).not.toHaveProperty("draftId");
    expect(values).not.toHaveProperty("draftUpdatedAt");
    expect(values).not.toHaveProperty("originatingFileId");
    expect(await screen.findByText(/^Saved /)).toBeTruthy();
    expect(hidden("draftId")).toBe("new1");
    expect(hidden("draftUpdatedAt")).toBe(T1);
  });

  test("saving an existing draft does not replace the URL and sends its version", async () => {
    save.mockResolvedValue({ ok: true, draftId: "d1", updatedAt: "2026-10-20T10:05:00.000Z" });
    const user = userEvent.setup();
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
    expect(screen.getByPlaceholderText(/client name/i)).toHaveValue("Maria Alvarez");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0].slice(0, 2)).toEqual(["d1", T1]);
    expect(router.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(hidden("draftUpdatedAt")).toBe("2026-10-20T10:05:00.000Z"));
  });

  test("the originating-file radio is not saved as a draft value", async () => {
    save.mockResolvedValue({ ok: true, draftId: "d1", updatedAt: T1 });
    const user = userEvent.setup();
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][2]).not.toHaveProperty("originatingFileMark");
  });

  test("a failed save shows 'Couldn't save the draft. Try again.'", async () => {
    save.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Couldn't save the draft. Try again.")).toBeTruthy();
  });

  test("an oversize draft shows 'This draft is too large to save.'", async () => {
    save.mockResolvedValue({ ok: false, code: "invalid" });
    const user = userEvent.setup();
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("This draft is too large to save.")).toBeTruthy();
  });

  test("stale: shows the verbatim message", async () => {
    save.mockResolvedValue({ ok: false, code: "stale" });
    const user = userEvent.setup();
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(
      await screen.findByText(/Someone else saved this draft\. Reload to see their changes\./),
    ).toBeTruthy();
  });

  test("gone (deleted or already used): 'This draft no longer exists', nothing re-created (Review Focus 1)", async () => {
    save.mockResolvedValue({ ok: false, code: "notfound" });
    const user = userEvent.setup();
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("This draft no longer exists")).toBeTruthy();
    expect(save.mock.calls[0][0]).toBe("d1"); // with an id, never null
    expect(router.replace).not.toHaveBeenCalled();
  });

  test("Create's used-draft refusal shows prominently at the top (Review Focus 1)", () => {
    // Mount with the action's error state (as after a server round trip).
    // Re-use the real hook via a mounted error: simulate by returning it.
    create.mockResolvedValue({
      status: "error",
      errors: { draftId: ["This draft was already used to open a matter."] },
      values: {},
    });
    return (async () => {
      const user = userEvent.setup();
      render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
      await user.click(screen.getByRole("button", { name: /create matter/i }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("This draft was already used to open a matter.");
      // First element in the form.
      expect(alert.closest("form")!.firstElementChild).toBe(alert);
    })();
  });
});

describe("NewMatterForm - auto-save", () => {
  test("saves a changed draft after 30 s, not an unchanged one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    save.mockResolvedValue({ ok: true, draftId: "d1", updatedAt: "2026-10-20T10:01:00.000Z" });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(save).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/case number/i), "2026-CV-9");
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][2].caseNumber).toBe("2026-CV-9");

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("paused while Create is in flight: a change made then is not auto-saved (Review Focus 2)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    save.mockResolvedValue({ ok: true, draftId: "d1", updatedAt: "2026-10-20T10:01:00.000Z" });
    create.mockImplementation(() => new Promise(() => {})); // never resolves
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);

    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    // Create is pending: the type-in below still lands in the DOM.
    await user.type(screen.getByLabelText(/case number/i), "X");
    await act(() => vi.advanceTimersByTimeAsync(90_000));
    expect(save).not.toHaveBeenCalled();
  });

  test("Create posts the draft id, its freshest version and the agreement fields", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const fd = create.mock.calls[0][1] as FormData;
    expect(fd.get("draftId")).toBe("d1");
    expect(fd.get("draftUpdatedAt")).toBe(T1);
    expect(fd.get("originatingFileId")).toBe("f1");
    expect(fd.get("agreementStatus")).toBe("not_sent");
    expect(fd.get("agreementSignedDate")).toBe("");
  });
});

describe("NewMatterForm - Engagement section", () => {
  test("switch on: markers show, and a gate error blocks Create without calling the action", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} engagement={engagement({ required: true })} />);
    await user.type(screen.getByPlaceholderText(/client name/i), "Zed Newperson");
    expect(screen.getByText("Files").textContent).toContain("*");
    await user.click(screen.getByRole("button", { name: /create matter/i }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText("Attach the signed Fee agreement.")).toBeTruthy();
    expect(screen.getByText("Mark the Fee agreement as signed.")).toBeTruthy();
    expect(screen.getByText("Enter the date it was signed.")).toBeTruthy();
  });

  test("a future signed date is refused client-side using the user's today", async () => {
    const user = userEvent.setup();
    render(
      <NewMatterForm
        options={options}
        draft={draft()}
        engagement={engagement({ required: true, todayKey: "2026-10-20" })}
      />,
    );
    await user.selectOptions(screen.getByLabelText(/^status/i), "signed");
    await user.type(screen.getByLabelText(/date signed/i), "2026-10-21");
    await user.click(screen.getByRole("button", { name: /create matter/i }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText("The signed date can't be in the future.")).toBeTruthy();

    // Today itself is fine (late evening in a US zone is already tomorrow in UTC).
    const date = screen.getByLabelText(/date signed/i);
    await user.clear(date);
    await user.type(date, "2026-10-20");
    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  test("switch off: Create goes through with no file", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} engagement={engagement({ required: false })} />);
    await user.type(screen.getByPlaceholderText(/client name/i), "Zed Newperson");
    await user.click(screen.getByRole("button", { name: /create matter/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  test("no documents.upload: the explanation shows instead of an upload button (Review Focus 3)", () => {
    render(
      <NewMatterForm
        options={options}
        engagement={engagement({ required: true, canUpload: false })}
      />,
    );
    expect(
      screen.getByText("You need permission to upload documents to attach the Fee agreement."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
  });

  test("changing the practice area retitles the section but keeps the files and the mark (Review Focus 5)", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
    expect(screen.getByRole("heading", { name: "Fee agreement" })).toBeTruthy();
    expect(hidden("originatingFileId")).toBe("f1");

    await user.selectOptions(screen.getByLabelText(/practice area/i), "a2");
    expect(screen.getByRole("heading", { name: "Retainer" })).toBeTruthy();
    expect(screen.getByText("retainer.pdf")).toBeTruthy();
    expect(screen.getByText("id.pdf")).toBeTruthy();
    expect(hidden("originatingFileId")).toBe("f1");
    expect(screen.getAllByLabelText(/this is the retainer/i)[0]).toBeChecked();
  });

  test("removing the marked file clears the mark", async () => {
    const user = userEvent.setup();
    render(<NewMatterForm options={options} draft={draft()} engagement={engagement()} />);
    await user.click(screen.getByRole("button", { name: "Remove retainer.pdf" }));
    await waitFor(() => expect(screen.queryByText("retainer.pdf")).toBeNull());
    expect(hidden("originatingFileId")).toBe("");
  });
});

describe("NewMatterForm - legacy feeStructure drafts", () => {
  const billingValue = () => (document.getElementById("billingType") as HTMLSelectElement).value;
  const resume = (a: ReturnType<typeof area>, feeStructure: string) =>
    render(
      <NewMatterForm
        options={{ ...options, areas: [a] }}
        draft={draft({
          values: { newClientName: "Maria Alvarez", practiceAreaId: "a1", name: "x", feeStructure },
        })}
        engagement={engagement()}
      />,
    );

  test("resumes the legacy feeStructure when the area allows it", () => {
    resume(area("a1", "Personal Injury"), "flat");
    expect(billingValue()).toBe("flat");
  });

  test("falls back to the area default when the area does not allow it", () => {
    resume(
      { ...area("a1", "Personal Injury"), allowedBillingTypes: ["contingent", "hourly"] },
      "flat",
    );
    expect(billingValue()).toBe("contingent");
  });
});
