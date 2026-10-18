import { describe, expect, it } from "vitest";
import {
  RECORDS_REQUEST_STATUSES,
  RECORDS_STATUS_LABEL,
  RECORDS_TERMINAL_STATUSES,
  checkRecordsTransition,
  isRecordsRequestOpen,
  isRecordsRequestOverdue,
} from "./status";
import { parseDateOnly } from "@/lib/format-date";

describe("records request status constants", () => {
  it("orders the statuses and labels every one", () => {
    expect(RECORDS_REQUEST_STATUSES).toEqual([
      "draft",
      "sent",
      "acknowledged",
      "partial",
      "complete",
      "denied",
      "withdrawn",
    ]);
    for (const s of RECORDS_REQUEST_STATUSES) {
      expect(RECORDS_STATUS_LABEL[s]).toBeTruthy();
    }
    expect(RECORDS_TERMINAL_STATUSES).toEqual(["complete", "denied", "withdrawn"]);
  });
});

describe("isRecordsRequestOpen", () => {
  it("is true only for non-terminal statuses", () => {
    expect(isRecordsRequestOpen("draft")).toBe(true);
    expect(isRecordsRequestOpen("partial")).toBe(true);
    expect(isRecordsRequestOpen("complete")).toBe(false);
    expect(isRecordsRequestOpen("withdrawn")).toBe(false);
    expect(isRecordsRequestOpen("bogus")).toBe(false);
  });
});

describe("checkRecordsTransition", () => {
  it("allows moving forward between non-terminal statuses", () => {
    expect(checkRecordsTransition("draft", "partial")).toEqual({ ok: true, reopen: false });
  });

  it("rejects moving backwards between non-terminal statuses", () => {
    expect(checkRecordsTransition("partial", "sent")).toEqual({ ok: false });
  });

  it("allows any non-terminal status to close to a terminal one", () => {
    expect(checkRecordsTransition("sent", "denied")).toEqual({ ok: true, reopen: false });
  });

  it("allows a terminal status to reopen to a non-terminal one", () => {
    expect(checkRecordsTransition("complete", "sent")).toEqual({ ok: true, reopen: true });
  });

  it("rejects terminal to terminal", () => {
    expect(checkRecordsTransition("complete", "withdrawn")).toEqual({ ok: false });
  });

  it("rejects same-to-same", () => {
    expect(checkRecordsTransition("sent", "sent")).toEqual({ ok: false });
  });
});

describe("isRecordsRequestOverdue", () => {
  const due = parseDateOnly("2026-10-17")!;
  const today = "2026-10-18";

  it("is overdue when open and due before today", () => {
    expect(isRecordsRequestOverdue({ status: "sent", responseDueDate: due }, today)).toBe(true);
  });

  it("is not overdue once complete", () => {
    expect(isRecordsRequestOverdue({ status: "complete", responseDueDate: due }, today)).toBe(false);
  });

  it("is not overdue without a due date", () => {
    expect(isRecordsRequestOverdue({ status: "sent", responseDueDate: null }, today)).toBe(false);
  });

  it("is not overdue on the due day itself", () => {
    expect(
      isRecordsRequestOverdue({ status: "sent", responseDueDate: parseDateOnly(today)! }, today),
    ).toBe(false);
  });
});
