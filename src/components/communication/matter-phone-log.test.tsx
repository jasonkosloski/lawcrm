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
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("./manual-call-actions", () => ({
  // Marker — the real component imports the deleteCallLog server
  // action (prisma), not loadable in happy-dom.
  ManualCallActions: ({ item }: { item: { matterName: string | null } }) => (
    <span
      data-testid="manual-call-actions"
      data-matter-name={item.matterName ?? ""}
    />
  ),
}));

function makeItem(
  overrides: Partial<MatterMessengerItemRow>
): MatterMessengerItemRow {
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
      />
    );
    expect(screen.getByTestId("manual-call-actions")).toBeInTheDocument();
  });

  test("provider call never gets the kebab, even with permissions", () => {
    render(
      <MatterPhoneLog
        items={[makeItem({ isManual: false })]}
        canEditCall
        canDeleteCall
      />
    );
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
      />
    );
    expect(screen.queryByTestId("manual-call-actions")).toBeNull();
  });

  test("directly-filed rows carry the page matter's name into the edit prefill", () => {
    render(
      <MatterPhoneLog
        items={[makeItem({ isManual: true, matterId: "matter_1" })]}
        canEditCall
        matterName="Smith v. Jones"
      />
    );
    expect(
      screen.getByTestId("manual-call-actions").dataset.matterName
    ).toBe("Smith v. Jones");
  });
});
