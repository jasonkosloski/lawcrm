/**
 * Tests for MatterPhoneLog — pins the edit/delete kebab gating:
 * manual call rows only, and only when the read-side permission
 * flags passed by the page allow it. Provider-synced rows and
 * SMS / voicemail rows never get the affordance.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatterPhoneLog } from "./matter-phone-log";
import type { MatterMessengerItemRow } from "@/lib/queries/messenger";

vi.mock("next/link", () => ({
  // Plain anchor — the real Link needs router context.
  default: ({ href, children, ...rest }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("./manual-call-actions", () => ({
  // Marker — the real component imports the deleteCallLog server
  // action (prisma), not loadable in happy-dom.
  ManualCallActions: ({ item }: { item: { matterName: string | null } }) => (
    <span data-testid="manual-call-actions" data-matter-name={item.matterName ?? ""} />
  ),
}));

function makeItem(overrides: Partial<MatterMessengerItemRow>): MatterMessengerItemRow {
  return {
    id: "item-1",
    threadId: "thread-1",
    kind: "call",
    direction: "outbound",
    callStatus: "answered",
    callDurationSec: 300,
    body: "Discussed schedule",
    matterId: null,
    isManual: false,
    contactName: "Dana Client",
    contactPhone: "+13035550182",
    occurredAt: new Date(2026, 5, 10, 14, 30),
    ...overrides,
  };
}

describe("kebab gating", () => {
  test("manual call + edit permission → kebab", () => {
    render(
      <MatterPhoneLog
        items={[makeItem({ isManual: true })]}
        canEditCall
        matterName="Smith v. Jones"
      />,
    );
    expect(screen.getByTestId("manual-call-actions")).toBeInTheDocument();
  });

  test("provider call never gets the kebab, even with permissions", () => {
    render(<MatterPhoneLog items={[makeItem({ isManual: false })]} canEditCall canDeleteCall />);
    expect(screen.queryByTestId("manual-call-actions")).toBeNull();
  });

  test("no permissions (default props) → no kebab on manual calls", () => {
    render(<MatterPhoneLog items={[makeItem({ isManual: true })]} />);
    expect(screen.queryByTestId("manual-call-actions")).toBeNull();
  });

  test("manual voicemail/SMS rows are not editable calls", () => {
    render(
      <MatterPhoneLog
        items={[
          makeItem({ id: "i1", kind: "sms", isManual: true }),
          makeItem({ id: "i2", kind: "voicemail", isManual: true }),
        ]}
        canEditCall
        canDeleteCall
      />,
    );
    expect(screen.queryByTestId("manual-call-actions")).toBeNull();
  });

  test("directly-filed rows carry the page matter's name into the edit prefill", () => {
    render(
      <MatterPhoneLog
        items={[makeItem({ isManual: true, matterId: "matter_1" })]}
        canEditCall
        matterName="Smith v. Jones"
      />,
    );
    expect(screen.getByTestId("manual-call-actions").dataset.matterName).toBe("Smith v. Jones");
  });
});

describe("times render in the viewer's zone", () => {
  test("a provider voicemail at 01:15Z shows the previous evening in Denver, with the year", () => {
    render(
      <MatterPhoneLog
        items={[
          makeItem({
            kind: "voicemail",
            direction: "inbound",
            callStatus: null,
            // 7:15 PM MDT on Jun 10 - Jun 11 01:15 in UTC.
            occurredAt: new Date("2026-06-11T01:15:00Z"),
          }),
        ]}
        tz="America/Denver"
      />,
    );
    expect(screen.getByText("Jun 10, 2026, 7:15 PM")).toBeInTheDocument();
  });
});

describe("missed-call labelling matches the shared predicate", () => {
  test("an outbound no-answer call is not labelled 'Missed call'", () => {
    render(
      <MatterPhoneLog items={[makeItem({ direction: "outbound", callStatus: "no_answer" })]} />,
    );
    expect(screen.queryByText(/Missed call/)).toBeNull();
    expect(screen.getByText("Outbound call, no answer · Dana Client")).toBeInTheDocument();
  });

  test("an inbound no-answer or declined call is 'Missed call'", () => {
    render(
      <MatterPhoneLog
        items={[
          makeItem({ id: "i1", direction: "inbound", callStatus: "no_answer" }),
          makeItem({ id: "i2", direction: "inbound", callStatus: "declined" }),
        ]}
      />,
    );
    expect(screen.getAllByText("Missed call · Dana Client")).toHaveLength(2);
  });

  test("an inbound answered call stays neutral", () => {
    render(<MatterPhoneLog items={[makeItem({ direction: "inbound", callStatus: "answered" })]} />);
    expect(screen.getByText("Inbound call · Dana Client")).toBeInTheDocument();
  });
});
