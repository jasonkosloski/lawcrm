/**
 * Tests for PracticeAreaRowActions: boundary reorder buttons are
 * disabled (so a click can't swap with a hidden archived neighbour),
 * and the archive-blocked alert uses the shared "move them" wording.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/practice-areas", () => ({
  movePracticeArea: vi.fn(async () => ({ ok: true })),
  setPracticeAreaActive: vi.fn(async () => ({ ok: true })),
}));

import {
  movePracticeArea,
  setPracticeAreaActive,
} from "@/app/actions/practice-areas";
import { PracticeAreaRowActions } from "./practice-area-row-actions";

beforeEach(() => {
  vi.mocked(movePracticeArea).mockClear();
  vi.mocked(setPracticeAreaActive).mockClear();
  vi.stubGlobal("alert", vi.fn());
});

describe("PracticeAreaRowActions", () => {
  test("disables Move up / Move down at the boundaries of the active list", () => {
    const { rerender } = render(
      <PracticeAreaRowActions
        areaId="a1"
        isActive
        activeMatterCount={0}
        canMoveUp={false}
        canMoveDown
      />
    );
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move down" })).toBeEnabled();

    rerender(
      <PracticeAreaRowActions
        areaId="a1"
        isActive
        activeMatterCount={0}
        canMoveUp
        canMoveDown={false}
      />
    );
    expect(screen.getByRole("button", { name: "Move up" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  test("an enabled move click reaches the action", async () => {
    const user = userEvent.setup();
    render(
      <PracticeAreaRowActions areaId="a1" isActive activeMatterCount={0} />
    );
    await user.click(screen.getByRole("button", { name: "Move down" }));
    await waitFor(() =>
      expect(movePracticeArea).toHaveBeenCalledWith("a1", "down")
    );
  });

  test("archive with matters alerts with the shared wording and does not call the action", async () => {
    const user = userEvent.setup();
    render(
      <PracticeAreaRowActions areaId="a1" isActive activeMatterCount={3} />
    );
    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(setPracticeAreaActive).not.toHaveBeenCalled();
    const msg = vi.mocked(globalThis.alert).mock.calls[0][0] as string;
    expect(msg).toMatch(/^Cannot archive/);
    expect(msg).toMatch(/Move them to another practice area first/);
  });
});
