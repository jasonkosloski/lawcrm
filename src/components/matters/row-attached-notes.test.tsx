/**
 * RowAttachedNotes - note timestamps are instants, shown in the
 * viewer's PROFILE zone (not the browser's), so SSR and hydration agree.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { RowAttachedNotes } from "./row-attached-notes";
import type { AttachedNotePreview } from "@/lib/queries/matter-detail";

const note = {
  id: "n1",
  type: "note",
  content: "<p>Body</p>",
  authorName: "Ann Author",
  authorInitials: "AA",
  createdAt: new Date("2026-04-15T03:30:00Z"),
} as AttachedNotePreview;

async function renderExpanded(timeZone: string) {
  const user = userEvent.setup();
  render(
    <UserTimeZoneProvider timeZone={timeZone}>
      <RowAttachedNotes notes={[note]} matterId="m1" />
    </UserTimeZoneProvider>,
  );
  await user.click(screen.getByRole("button", { name: /1 note/i }));
}

describe("RowAttachedNotes timestamps", () => {
  test("renders in the profile zone: 03:30Z is Apr 14, 9:30 PM in Denver", async () => {
    await renderExpanded("America/Denver");
    expect(screen.getByText("Apr 14, 9:30 PM")).toBeInTheDocument();
  });

  test("a different profile zone renders a different wall-clock time", async () => {
    await renderExpanded("UTC");
    expect(screen.getByText("Apr 15, 3:30 AM")).toBeInTheDocument();
  });
});
