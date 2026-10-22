/**
 * Tests for the Log call button + CallLogDialog.
 *
 * Pins:
 *   1. The dialog stays MOUNTED across opens (LogCallButton and
 *      ManualCallActions render it unconditionally), so a close
 *      effect keyed on `state.status` never re-fires after the first
 *      success: the SECOND log/edit left the dialog open and invited
 *      a duplicate call log. It must close every time, and a failed
 *      attempt's field errors must not reappear on the next open.
 *   2. The "When" field is zone-less wall-clock text in the viewer's
 *      PROFILE zone. The action parses `occurredAt` on a UTC server,
 *      so the dialog must post the real instant - otherwise a Denver
 *      2:30 PM call is stored as 14:30Z and every edit shifts it by
 *      the UTC offset again.
 */

import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const logCall = vi.fn();
const updateCallLog = vi.fn();
vi.mock("@/app/actions/calls", () => ({
  logCall: (...args: unknown[]) => logCall(...args),
  updateCallLog: (...args: unknown[]) => updateCallLog(...args),
}));

import { UserTimeZoneProvider } from "@/components/user-time-zone";
import type { EditableCallLog } from "@/lib/call-log-form";
import { CallLogDialog, LogCallButton } from "./log-call-button";

const TZ = "America/Denver";

const contact = {
  id: "contact-1",
  name: "Dana Client",
  organization: null,
  phone: "+13035550182",
};

// Fresh object per call - mirrors real server actions (never
// reference-equal across submissions).
beforeEach(() => {
  logCall.mockReset();
  updateCallLog.mockReset();
  logCall.mockImplementation(async () => ({ status: "ok" as const }));
  updateCallLog.mockImplementation(async () => ({ status: "ok" as const }));
});

// Base UI locks body pointer-events while a dialog is open.
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

function withTz(ui: React.ReactNode) {
  return <UserTimeZoneProvider timeZone={TZ}>{ui}</UserTimeZoneProvider>;
}

const whenInput = () => screen.getByLabelText("When") as HTMLInputElement;

describe("LogCallButton", () => {
  test("has an accessible name even when the text label is hidden (phones)", () => {
    render(withTz(<LogCallButton contacts={[]} />));
    // The text span is display:none below sm, so the name must come
    // from an explicit label.
    expect(screen.getByRole("button", { name: "Log call" })).toHaveAttribute(
      "aria-label",
      "Log call",
    );
  });
});

describe("CallLogDialog - close on success", () => {
  function Harness({ edit }: { edit?: EditableCallLog }) {
    const [open, setOpen] = useState(true);
    return withTz(
      <>
        <button type="button" onClick={() => setOpen(true)}>
          reopen dialog
        </button>
        <CallLogDialog
          open={open}
          onOpenChange={setOpen}
          fixedContact={edit ? undefined : contact}
          edit={edit}
        />
      </>,
    );
  }

  test("a SECOND successful log closes the dialog again (no duplicate-inviting open dialog)", async () => {
    const user = setupUser();
    render(<Harness />);

    await user.click(await screen.findByRole("button", { name: "Log call" }));
    await waitFor(() => expect(screen.queryByText("Log a call")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "reopen dialog" }));
    await user.click(await screen.findByRole("button", { name: "Log call" }));

    await waitFor(() => expect(screen.queryByText("Log a call")).not.toBeInTheDocument());
    expect(logCall).toHaveBeenCalledTimes(2);
  });

  test("a SECOND successful edit closes the dialog again", async () => {
    const user = setupUser();
    render(<Harness edit={editable()} />);

    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByText("Edit call log")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "reopen dialog" }));
    await user.click(await screen.findByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByText("Edit call log")).not.toBeInTheDocument());
    expect(updateCallLog).toHaveBeenCalledTimes(2);
  });

  test("a failed attempt's errors do not reappear after close + reopen", async () => {
    logCall.mockImplementation(async () => ({
      status: "error" as const,
      errors: { phone: ["This contact has no phone on file"] },
    }));
    const user = setupUser();
    render(<Harness />);

    await user.click(await screen.findByRole("button", { name: "Log call" }));
    expect(await screen.findByText("This contact has no phone on file")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Log a call")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "reopen dialog" }));

    await screen.findByText("Log a call");
    expect(screen.queryByText("This contact has no phone on file")).not.toBeInTheDocument();
  });
});

function editable(overrides: Partial<EditableCallLog> = {}): EditableCallLog {
  return {
    id: "item-1",
    contactLabel: "Dana Client",
    direction: "outbound",
    outcome: "answered",
    // 2:30 PM in Denver (MDT, UTC-6).
    occurredAt: new Date("2026-06-10T20:30:00.000Z"),
    durationSec: 300,
    matterId: null,
    matterName: null,
    summary: "Discussed schedule",
    ...overrides,
  };
}

describe("CallLogDialog - call time is posted as the real instant", () => {
  test("create: the typed wall-clock time is read in the profile zone", async () => {
    const user = setupUser();
    render(withTz(<CallLogDialog open onOpenChange={() => {}} fixedContact={contact} />));

    fireEvent.change(whenInput(), { target: { value: "2026-06-10T14:30" } });
    await user.click(await screen.findByRole("button", { name: "Log call" }));

    await waitFor(() => expect(logCall).toHaveBeenCalledOnce());
    const fd = logCall.mock.calls[0]![1] as FormData;
    // 2:30 PM MDT is 20:30Z - NOT 14:30Z (what a zone-less string
    // parsed on a UTC server would store).
    expect(fd.get("occurredAt")).toBe("2026-06-10T20:30:00.000Z");
  });

  test("edit: prefill shows profile-zone wall time and an unchanged save keeps the instant", async () => {
    const user = setupUser();
    render(withTz(<CallLogDialog open onOpenChange={() => {}} edit={editable()} />));

    // Prefill is 2:30 PM Denver, not the UTC wall time (20:30).
    expect(whenInput().value).toBe("2026-06-10T14:30");

    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateCallLog).toHaveBeenCalledOnce());
    const fd = updateCallLog.mock.calls[0]![1] as FormData;
    // Round trip is stable: no drift by the UTC offset per edit.
    expect(fd.get("occurredAt")).toBe("2026-06-10T20:30:00.000Z");
    expect(fd.get("itemId")).toBe("item-1");
  });

  test("edit: an unchanged save keeps the stored seconds; an edited time is re-parsed", async () => {
    const user = setupUser();
    const { unmount } = render(
      withTz(
        <CallLogDialog
          open
          onOpenChange={() => {}}
          edit={editable({
            occurredAt: new Date("2026-06-10T20:30:42.000Z"),
          })}
        />,
      ),
    );
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateCallLog).toHaveBeenCalledOnce());
    expect((updateCallLog.mock.calls[0]![1] as FormData).get("occurredAt")).toBe(
      "2026-06-10T20:30:42.000Z",
    );
    unmount();

    updateCallLog.mockClear();
    render(
      withTz(
        <CallLogDialog
          open
          onOpenChange={() => {}}
          edit={editable({
            occurredAt: new Date("2026-06-10T20:30:42.000Z"),
          })}
        />,
      ),
    );
    fireEvent.change(whenInput(), { target: { value: "2026-06-10T15:00" } });
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateCallLog).toHaveBeenCalledOnce());
    expect((updateCallLog.mock.calls[0]![1] as FormData).get("occurredAt")).toBe(
      "2026-06-10T21:00:00.000Z",
    );
  });

  test("a blank When field posts an empty instant (server reports the field error)", async () => {
    const user = setupUser();
    render(withTz(<CallLogDialog open onOpenChange={() => {}} fixedContact={contact} />));

    fireEvent.change(whenInput(), { target: { value: "" } });
    await user.click(await screen.findByRole("button", { name: "Log call" }));

    await waitFor(() => expect(logCall).toHaveBeenCalledOnce());
    const fd = logCall.mock.calls[0]![1] as FormData;
    expect(fd.get("occurredAt")).toBe("");
  });
});
