/**
 * FileThreadPicker: read-only without communication.file_email, Unfile
 * hidden when the thread must stay filed, lead picks call the action
 * with a lead scope, and failures show inline.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const setEmailThreadRecord = vi.fn();
vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("@/app/actions/email-filing", () => ({
  setEmailThreadRecord: (...args: unknown[]) => setEmailThreadRecord(...args),
}));

import type { FilingLeadOption, FilingMatterOption } from "@/lib/queries/communication";
import { notifyError } from "@/lib/feedback";
import { FileThreadPicker } from "./file-thread-picker";

const matters = [
  {
    id: "m1",
    name: "Smith v. Jones",
    color: "#123456",
    area: "Civil",
    isPinned: false,
  },
] as unknown as FilingMatterOption[];
const leads = [{ id: "l1", name: "Pat Prospect", stage: "new" }] as unknown as FilingLeadOption[];

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  setEmailThreadRecord.mockReset();
  vi.mocked(notifyError).mockReset();
});

describe("without communication.file_email", () => {
  test("a matter-filed thread shows only the matter link", () => {
    render(
      <FileThreadPicker
        threadId="t1"
        current={{ kind: "matter", matterId: "m1" }}
        currentLabel="Smith v. Jones"
        matters={matters}
        leads={leads}
        canFile={false}
        canUnfile
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/matters/m1");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a lead-filed thread shows a Lead-tagged link", () => {
    render(
      <FileThreadPicker
        threadId="t1"
        current={{ kind: "lead", leadId: "l1" }}
        currentLabel="Pat Prospect"
        matters={matters}
        leads={leads}
        canFile={false}
        canUnfile
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/intake/l1");
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("an unfiled thread shows a plain 'Unfiled' label", () => {
    render(
      <FileThreadPicker
        threadId="t1"
        current={null}
        currentLabel={null}
        matters={matters}
        leads={leads}
        canFile={false}
        canUnfile
      />,
    );
    expect(screen.getByText("Unfiled")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("filing", () => {
  test("picking a lead files the thread to that lead", async () => {
    setEmailThreadRecord.mockResolvedValue({ ok: true });
    const user = setupUser();
    render(
      <FileThreadPicker
        threadId="t1"
        current={null}
        currentLabel={null}
        matters={matters}
        leads={leads}
        canFile
        canUnfile
      />,
    );
    await user.click(screen.getByRole("button", { name: /file to matter or lead/i }));
    await user.click(await screen.findByRole("button", { name: /Pat Prospect/ }));
    await waitFor(() =>
      expect(setEmailThreadRecord).toHaveBeenCalledWith("t1", {
        kind: "lead",
        leadId: "l1",
      }),
    );
  });

  test("Unfile is hidden when canUnfile is false", async () => {
    const user = setupUser();
    render(
      <FileThreadPicker
        threadId="t1"
        current={{ kind: "lead", leadId: "l1" }}
        currentLabel="Pat Prospect"
        matters={matters}
        leads={leads}
        canFile
        canUnfile={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: /change matter or lead/i }));
    await screen.findByRole("button", { name: /Smith v\. Jones/ });
    expect(screen.queryByText(/Unfile/)).toBeNull();
  });

  test("Unfile is offered when allowed and files to null", async () => {
    setEmailThreadRecord.mockResolvedValue({ ok: true });
    const user = setupUser();
    render(
      <FileThreadPicker
        threadId="t1"
        current={{ kind: "matter", matterId: "m1" }}
        currentLabel="Smith v. Jones"
        matters={matters}
        leads={leads}
        canFile
        canUnfile
      />,
    );
    await user.click(screen.getByRole("button", { name: /change matter or lead/i }));
    await user.click(await screen.findByRole("button", { name: /Unfile/ }));
    await waitFor(() => expect(setEmailThreadRecord).toHaveBeenCalledWith("t1", null));
  });

  test("an action error shows inline", async () => {
    setEmailThreadRecord.mockResolvedValue({ ok: false, error: "Nope." });
    const user = setupUser();
    render(
      <FileThreadPicker
        threadId="t1"
        current={null}
        currentLabel={null}
        matters={matters}
        leads={leads}
        canFile
        canUnfile
      />,
    );
    await user.click(screen.getByRole("button", { name: /file to matter or lead/i }));
    await user.click(await screen.findByRole("button", { name: /Smith v\. Jones/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
  });

  test("a thrown action toasts instead of throwing", async () => {
    setEmailThreadRecord.mockImplementation(async () => {
      throw new Error("db down");
    });
    const user = setupUser();
    render(
      <FileThreadPicker
        threadId="t1"
        current={null}
        currentLabel={null}
        matters={matters}
        leads={leads}
        canFile
        canUnfile
      />,
    );
    await user.click(screen.getByRole("button", { name: /file to matter or lead/i }));
    await user.click(await screen.findByRole("button", { name: /Smith v\. Jones/ }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(expect.stringMatching(/try again/i)),
    );
  });
});
