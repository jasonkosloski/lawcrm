/**
 * RequestDetailPanel: Mark sent posts the send action; destructive and
 * edit controls follow the viewer's permissions; after an upload the
 * panel offers (never auto-applies) Mark partial / Mark complete.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  usePathname: () => "/matters/m1/records",
  useSearchParams: () => new URLSearchParams("request=r1"),
}));

const sentMock = vi.fn();
const statusMock = vi.fn();
const deleteMock = vi.fn();
const noop = vi.fn();
vi.mock("@/app/actions/records-requests", () => ({
  markRecordsRequestSent: (...a: unknown[]) => sentMock(...a),
  setRecordsRequestStatus: (...a: unknown[]) => statusMock(...a),
  deleteRecordsRequest: (...a: unknown[]) => deleteMock(...a),
  updateRecordsRequest: (...a: unknown[]) => noop(...a),
  logRecordsFollowUp: (...a: unknown[]) => noop(...a),
  saveRecordsFee: (...a: unknown[]) => noop(...a),
  linkRecordsDocuments: vi.fn(async () => ({ ok: true })),
  unlinkRecordsDocument: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/components/matters/documents/multi-file-upload", () => ({
  MultiFileUpload: (p: { recordsRequestId?: string; onUploaded?: () => void }) => (
    <button type="button" onClick={() => p.onUploaded?.()}>
      mock-upload {p.recordsRequestId}
    </button>
  ),
}));
vi.mock("@/components/templates/generate-from-template-dialog", () => ({
  GenerateFromTemplateDialog: () => <div data-testid="generate" />,
}));

import { RequestDetailPanel } from "./request-detail-panel";
import type { RecordsRequestDetail } from "@/lib/queries/records-requests";

function detail(over: Partial<RecordsRequestDetail> = {}): RecordsRequestDetail {
  return {
    id: "r1",
    status: "draft",
    subject: "ER chart",
    description: null,
    custodianContactId: "c1",
    custodianName: "St. Mary's",
    typeId: "t1",
    adHocTypeName: null,
    typeName: "Medical records",
    dateRangeStart: null,
    dateRangeEnd: null,
    sentAt: null,
    receivedAt: null,
    responseDueDate: null,
    nextFollowUpDate: null,
    ownerId: "u1",
    ownerName: "Me",
    feeEstimate: null,
    feeAmount: null,
    feePaidAt: null,
    expenseLocked: false,
    followUps: [],
    documents: [],
    updatedAt: "2026-10-18T00:00:00.000Z",
    ...over,
  };
}

const CAN = { edit: true, delete: true, upload: true, fee: true };

function renderPanel(
  d: RecordsRequestDetail,
  can: Partial<typeof CAN> = {},
  writable = true
) {
  return render(
    <RequestDetailPanel
      detail={d}
      scope={{ kind: "matter", matterId: "m1" }}
      types={[{ id: "t1", name: "Medical records" }]}
      users={[{ id: "u1", name: "Me" }]}
      templates={[]}
      defaultTemplateId={null}
      storageDriver="local"
      linkableDocuments={[]}
      can={{ ...CAN, ...can }}
      writable={writable}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sentMock.mockResolvedValue({ status: "ok" });
  statusMock.mockResolvedValue({ ok: true });
  deleteMock.mockResolvedValue({ ok: true });
});

describe("RequestDetailPanel", () => {
  test("Mark sent posts markRecordsRequestSent with the dates", async () => {
    const user = userEvent.setup();
    renderPanel(detail());
    await user.type(screen.getByLabelText("Sent on"), "2026-10-17");
    await user.click(screen.getByRole("button", { name: "Mark sent" }));
    await waitFor(() => expect(sentMock).toHaveBeenCalledTimes(1));
    const [id, , fd] = sentMock.mock.calls[0] as [string, unknown, FormData];
    expect(id).toBe("r1");
    expect(fd.get("sentAt")).toBe("2026-10-17");
  });

  test("delete is hidden without records.delete and shown with it", () => {
    const { unmount } = renderPanel(detail(), { delete: false });
    expect(screen.queryByRole("button", { name: /delete request/i })).toBeNull();
    unmount();
    renderPanel(detail());
    expect(screen.getByRole("button", { name: /delete request/i })).toBeInTheDocument();
  });

  test("read-only viewers see no edit, send, upload or fee controls", () => {
    renderPanel(detail(), { edit: false, upload: false, fee: false, delete: false });
    expect(screen.queryByRole("button", { name: "Mark sent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByText(/mock-upload/)).toBeNull();
    expect(screen.queryByLabelText("Fee paid on")).toBeNull();
  });

  test("a converted lead (not writable) hides every mutation", () => {
    renderPanel(detail(), {}, false);
    expect(screen.queryByRole("button", { name: "Mark sent" })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete request/i })).toBeNull();
    expect(screen.queryByText(/mock-upload/)).toBeNull();
  });

  test("after an upload, Mark complete appears and posts the status", async () => {
    const user = userEvent.setup();
    renderPanel(detail({ status: "sent", sentAt: new Date("2026-10-10T00:00:00Z") }));
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
    await user.click(screen.getByText(/mock-upload r1/));
    expect(statusMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Mark partial" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark complete" }));
    await waitFor(() => expect(statusMock).toHaveBeenCalledWith("r1", "complete"));
  });

  test("no inline marks when the request is already terminal", async () => {
    const user = userEvent.setup();
    renderPanel(detail({ status: "complete" }));
    await user.click(screen.getByText(/mock-upload r1/));
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark partial" })).toBeNull();
  });

  test("the fee section is hidden when can.fee is false", () => {
    renderPanel(detail(), { fee: false });
    expect(screen.queryByLabelText("Fee paid on")).toBeNull();
  });

  test("Tab wraps focus between the first and last control", async () => {
    const user = userEvent.setup();
    renderPanel(detail());
    const dialog = screen.getByRole("dialog");
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])")
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);
    first.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  test("a failed unlink is surfaced", async () => {
    const { unlinkRecordsDocument } = await import("@/app/actions/records-requests");
    vi.mocked(unlinkRecordsDocument).mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    renderPanel(
      detail({ documents: [{ id: "d1", name: "Letter.md", role: "request_letter", href: "/x" }] })
    );
    await user.click(screen.getByRole("button", { name: "Unlink Letter.md" }));
    expect(await screen.findByText("Couldn't unlink the document.")).toBeInTheDocument();
  });
});
