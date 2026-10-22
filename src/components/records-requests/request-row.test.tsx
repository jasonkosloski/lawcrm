import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { dueBadge } from "@/lib/records-requests/due-badge";
import { RequestRow } from "./request-row";
import type { RecordsRequestRow } from "@/lib/queries/records-requests";

const row = (o: Partial<RecordsRequestRow> = {}): RecordsRequestRow => ({
  id: "r1",
  status: "sent",
  subject: "ER chart",
  custodianName: "St. Mary's",
  typeName: "Medical records",
  sentAt: null,
  responseDueDate: null,
  nextFollowUpDate: null,
  daysUntilDue: null,
  isOverdue: false,
  feeAmount: null,
  letterCount: 1,
  recordsCount: 2,
  ownerInitials: "AB",
  ...o,
});

describe("dueBadge", () => {
  test("labels left, today and overdue", () => {
    expect(dueBadge(row({ daysUntilDue: 5 }))).toEqual({ text: "5d left", overdue: false });
    expect(dueBadge(row({ daysUntilDue: 0 }))).toEqual({ text: "Due today", overdue: false });
    expect(dueBadge(row({ daysUntilDue: -3 }))).toEqual({ text: "3d overdue", overdue: true });
  });
  test("no badge without a due date or once closed", () => {
    expect(dueBadge(row())).toBeNull();
    expect(dueBadge(row({ status: "complete", daysUntilDue: -3 }))).toBeNull();
  });
});

describe("RequestRow", () => {
  test("links to the panel on the scope's records tab", () => {
    render(
      <ul>
        <RequestRow row={row()} scope={{ kind: "lead", leadId: "l1" }} />
      </ul>,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("/intake/l1/records/r1");
  });
});
