/**
 * RequestDetail: Mark sent posts the send action; destructive and
 * edit controls follow the viewer's permissions; after an upload the
 * page offers (never auto-applies) Mark partial / Mark complete.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push }),
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
  MultiFileUpload: (p: {
    recordsRequestId?: string;
    recordsRole?: string;
    onUploaded?: () => void;
  }) => (
    <button type="button" onClick={() => p.onUploaded?.()}>
      mock-upload {p.recordsRole} {p.recordsRequestId}
    </button>
  ),
}));
vi.mock("@/components/templates/generate-from-template-dialog", () => ({
  GenerateFromTemplateDialog: (p: { team?: unknown[]; contacts?: unknown[] }) => (
    <div data-testid="generate" data-team={p.team?.length} data-contacts={p.contacts?.length} />
  ),
}));

import { RequestDetail } from "./request-detail";
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

function renderDetail(
  d: RecordsRequestDetail,
  can: Partial<typeof CAN> = {},
  writable = true,
  daysUntilDue: number | null = null,
  generateOptions?: {
    team: { id: string; name: string }[];
    contacts: { id: string; name: string; role: string | null }[];
    currentUserId: string;
  },
) {
  return render(
    <RequestDetail
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
      daysUntilDue={daysUntilDue}
      generateOptions={generateOptions}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sentMock.mockResolvedValue({ status: "ok" });
  statusMock.mockResolvedValue({ ok: true });
  deleteMock.mockResolvedValue({ ok: true });
});

describe("RequestDetail", () => {
  test("Mark sent posts markRecordsRequestSent with the dates", async () => {
    const user = userEvent.setup();
    renderDetail(detail());
    await user.type(screen.getByLabelText("Sent on"), "2026-10-17");
    await user.click(screen.getByRole("button", { name: "Mark sent" }));
    await waitFor(() => expect(sentMock).toHaveBeenCalledTimes(1));
    const [id, , fd] = sentMock.mock.calls[0] as [string, unknown, FormData];
    expect(id).toBe("r1");
    expect(fd.get("sentAt")).toBe("2026-10-17");
  });

  test("delete is hidden without records.delete and shown with it", () => {
    const { unmount } = renderDetail(detail(), { delete: false });
    expect(screen.queryByRole("button", { name: /delete request/i })).toBeNull();
    unmount();
    renderDetail(detail());
    expect(screen.getByRole("button", { name: /delete request/i })).toBeInTheDocument();
  });

  test("read-only viewers see no edit, send, upload or fee controls", () => {
    renderDetail(detail(), { edit: false, upload: false, fee: false, delete: false });
    expect(screen.queryByRole("button", { name: "Mark sent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByText(/mock-upload/)).toBeNull();
    expect(screen.queryByLabelText("Fee paid on")).toBeNull();
  });

  test("a converted lead (not writable) hides every mutation", () => {
    renderDetail(detail(), {}, false);
    expect(screen.queryByRole("button", { name: "Mark sent" })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete request/i })).toBeNull();
    expect(screen.queryByText(/mock-upload/)).toBeNull();
  });

  test("after an upload, Mark complete appears and posts the status", async () => {
    const user = userEvent.setup();
    renderDetail(detail({ status: "sent", sentAt: new Date("2026-10-10T00:00:00Z") }));
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
    await user.click(screen.getByText("mock-upload received_records r1"));
    expect(statusMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Mark partial" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark complete" }));
    await waitFor(() => expect(statusMock).toHaveBeenCalledWith("r1", "complete"));
  });

  test("uploads pass the matching recordsRole, one per section", () => {
    renderDetail(detail());
    expect(screen.getByText("mock-upload request_letter r1")).toBeInTheDocument();
    expect(screen.getByText("mock-upload received_records r1")).toBeInTheDocument();
  });

  test("Generate letter appears only inside Request documents", () => {
    renderDetail(detail());
    const generate = screen.getByTestId("generate");
    const reqSection = screen
      .getByRole("heading", { name: "Request documents" })
      .closest("section");
    const respSection = screen
      .getByRole("heading", { name: "Responsive documents" })
      .closest("section");
    expect(reqSection).toContainElement(generate);
    expect(respSection).not.toContainElement(generate);
  });

  test("a request-document upload does not offer Mark partial / complete", async () => {
    const user = userEvent.setup();
    renderDetail(detail({ status: "sent", sentAt: new Date("2026-10-10T00:00:00Z") }));
    await user.click(screen.getByText("mock-upload request_letter r1"));
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
  });

  test("documents are listed under their role's section", () => {
    renderDetail(
      detail({
        documents: [
          { id: "d1", name: "Letter.md", role: "request_letter", href: "/x" },
          { id: "d2", name: "Chart.pdf", role: "received_records", href: "/y" },
        ],
      }),
    );
    const reqSection = screen
      .getByRole("heading", { name: "Request documents" })
      .closest("section");
    const respSection = screen
      .getByRole("heading", { name: "Responsive documents" })
      .closest("section");
    expect(reqSection).toHaveTextContent("Letter.md");
    expect(reqSection).not.toHaveTextContent("Chart.pdf");
    expect(respSection).toHaveTextContent("Chart.pdf");
  });

  test("linking existing documents passes the section's role; marks only for responsive", async () => {
    const { linkRecordsDocuments } = await import("@/app/actions/records-requests");
    const user = userEvent.setup();
    render(
      <RequestDetail
        detail={detail({ status: "sent", sentAt: new Date("2026-10-10T00:00:00Z") })}
        scope={{ kind: "matter", matterId: "m1" }}
        types={[{ id: "t1", name: "Medical records" }]}
        users={[{ id: "u1", name: "Me" }]}
        templates={[]}
        defaultTemplateId={null}
        storageDriver="local"
        linkableDocuments={[{ id: "x1", name: "Old.pdf" }]}
        can={CAN}
        writable
      />,
    );
    const reqSection = screen
      .getByRole("heading", { name: "Request documents" })
      .closest("section")!;
    const respSection = screen
      .getByRole("heading", { name: "Responsive documents" })
      .closest("section")!;
    await user.click(within(reqSection).getByText("Link existing documents"));
    await user.click(within(reqSection).getByRole("checkbox", { name: "Old.pdf" }));
    await user.click(within(reqSection).getByRole("button", { name: "Link selected" }));
    await waitFor(() =>
      expect(linkRecordsDocuments).toHaveBeenCalledWith("r1", ["x1"], "request_letter"),
    );
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
    await user.click(within(respSection).getByText("Link existing documents"));
    await user.click(within(respSection).getByRole("checkbox", { name: "Old.pdf" }));
    await user.click(within(respSection).getByRole("button", { name: "Link selected" }));
    await waitFor(() =>
      expect(linkRecordsDocuments).toHaveBeenLastCalledWith("r1", ["x1"], "received_records"),
    );
    expect(await screen.findByRole("button", { name: "Mark complete" })).toBeInTheDocument();
  });

  test("no inline marks when the request is already terminal", async () => {
    const user = userEvent.setup();
    renderDetail(detail({ status: "complete" }));
    await user.click(screen.getByText("mock-upload received_records r1"));
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark partial" })).toBeNull();
  });

  test("a draft hides Log follow-up and the post-upload marks", async () => {
    const user = userEvent.setup();
    renderDetail(detail({ status: "draft" }));
    expect(screen.queryByRole("button", { name: "Log follow-up" })).toBeNull();
    await user.click(screen.getByText("mock-upload received_records r1"));
    expect(screen.queryByRole("button", { name: "Mark partial" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
  });

  test("a sent request shows Log follow-up", () => {
    renderDetail(detail({ status: "sent", sentAt: new Date("2026-10-10T00:00:00Z") }));
    expect(screen.getByRole("button", { name: "Log follow-up" })).toBeInTheDocument();
  });

  test("a never-sent closed request reopens only as a draft", () => {
    renderDetail(detail({ status: "withdrawn", sentAt: null }));
    expect(screen.getByRole("button", { name: "Draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sent" })).toBeNull();
  });

  test("a sent closed request reopens to sent-or-later, never draft", () => {
    renderDetail(detail({ status: "complete", sentAt: new Date("2026-10-10T00:00:00Z") }));
    expect(screen.getByRole("button", { name: "Sent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draft" })).toBeNull();
  });

  test("the fee section is hidden when can.fee is false", () => {
    renderDetail(detail(), { fee: false });
    expect(screen.queryByLabelText("Fee paid on")).toBeNull();
  });

  test("is a page, not a modal, with a back link to the records list", () => {
    renderDetail(detail());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "ER chart" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /records requests/i }).getAttribute("href")).toBe(
      "/matters/m1/records",
    );
  });

  test("shows the due badge from daysUntilDue, hidden once closed", () => {
    const { unmount } = renderDetail(
      detail({ status: "sent", sentAt: new Date("2026-10-10T00:00:00Z") }),
      {},
      true,
      -2,
    );
    expect(screen.getByText("2d overdue")).toBeInTheDocument();
    unmount();
    renderDetail(detail({ status: "complete" }), {}, true, -2);
    expect(screen.queryByText("2d overdue")).toBeNull();
  });

  test("a successful delete navigates to the records list", async () => {
    const user = userEvent.setup();
    renderDetail(detail());
    await user.click(screen.getByRole("button", { name: /delete request/i }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/matters/m1/records"));
  });

  test("a failed delete stays put and shows the error", async () => {
    deleteMock.mockResolvedValue({ ok: false, error: "Nope." });
    const user = userEvent.setup();
    renderDetail(detail());
    await user.click(screen.getByRole("button", { name: /delete request/i }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByText("Nope.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  test("a failed unlink is surfaced", async () => {
    const { unlinkRecordsDocument } = await import("@/app/actions/records-requests");
    vi.mocked(unlinkRecordsDocument).mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    renderDetail(
      detail({ documents: [{ id: "d1", name: "Letter.md", role: "request_letter", href: "/x" }] }),
    );
    await user.click(screen.getByRole("button", { name: "Unlink Letter.md" }));
    expect(await screen.findByText("Couldn't unlink the document.")).toBeInTheDocument();
  });

  describe("key dates", () => {
    function renderDates(
      d: RecordsRequestDetail,
      extra: {
        daysUntilDue?: number | null;
        daysSinceSent?: number | null;
        deadlineRule?: string | null;
      },
    ) {
      return render(
        <RequestDetail
          detail={d}
          scope={{ kind: "matter", matterId: "m1" }}
          types={[{ id: "t1", name: "Medical records" }]}
          users={[{ id: "u1", name: "Me" }]}
          templates={[]}
          defaultTemplateId={null}
          storageDriver="local"
          linkableDocuments={[]}
          can={CAN}
          writable
          daysUntilDue={extra.daysUntilDue ?? null}
          daysSinceSent={extra.daysSinceSent ?? null}
          deadlineRule={extra.deadlineRule ?? null}
        />,
      );
    }

    test("a sent request shows the sent date, how long ago, the due date, countdown and rule", () => {
      renderDates(
        detail({
          status: "sent",
          sentAt: new Date("2026-10-16T00:00:00Z"),
          responseDueDate: new Date("2026-10-21T00:00:00Z"),
        }),
        { daysSinceSent: 2, daysUntilDue: 3, deadlineRule: "3 business days after sending" },
      );
      const sent = screen.getByTestId("sent-tile");
      expect(sent).toHaveTextContent("Oct 16, 2026");
      expect(sent).toHaveTextContent("2 days ago");
      const due = screen.getByTestId("due-tile");
      expect(due).toHaveTextContent("Oct 21, 2026");
      expect(due).toHaveTextContent("3 days left");
      expect(due).toHaveTextContent("3 business days after sending");
    });

    test("an overdue request says so in the due tile", () => {
      renderDates(
        detail({
          status: "acknowledged",
          sentAt: new Date("2026-10-01T00:00:00Z"),
          responseDueDate: new Date("2026-10-06T00:00:00Z"),
        }),
        { daysSinceSent: 17, daysUntilDue: -12 },
      );
      const due = screen.getByTestId("due-tile");
      expect(due).toHaveTextContent("12 days overdue");
      expect(due).toHaveTextContent("Set manually");
    });

    test("a draft explains the clock hasn't started", () => {
      renderDates(detail(), {});
      expect(screen.getByTestId("sent-tile")).toHaveTextContent("Not sent yet");
      expect(screen.getByTestId("due-tile")).toHaveTextContent("Set when sent");
    });

    test("a closed request shows no countdown", () => {
      renderDates(
        detail({
          status: "complete",
          sentAt: new Date("2026-10-01T00:00:00Z"),
          responseDueDate: new Date("2026-10-06T00:00:00Z"),
          receivedAt: new Date("2026-10-05T00:00:00Z"),
        }),
        { daysUntilDue: -12 },
      );
      expect(screen.getByTestId("due-tile")).not.toHaveTextContent("overdue");
    });
  });

  test("the letter dialog receives signer and recipient options", () => {
    renderDetail(detail(), {}, true, null, {
      team: [{ id: "u1", name: "Me" }],
      contacts: [{ id: "c1", name: "Pat", role: null }],
      currentUserId: "u1",
    });
    expect(screen.getByTestId("generate")).toHaveAttribute("data-team", "1");
    expect(screen.getByTestId("generate")).toHaveAttribute("data-contacts", "1");
  });
});
