/**
 * Component tests for the thread-row star/archive cluster.
 *
 * Server actions are stubbed at module level (the layer-2 pattern);
 * what's pinned here is the optimistic star flip + revert-on-failure
 * and the archive/unarchive wiring (right threadId, right direction).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/email-thread-flags", () => ({
  toggleEmailThreadStar: vi.fn(),
  setEmailThreadArchived: vi.fn(),
}));

import {
  setEmailThreadArchived,
  toggleEmailThreadStar,
} from "@/app/actions/email-thread-flags";
import { ThreadRowActions } from "./thread-row-actions";

const mockedToggleStar = vi.mocked(toggleEmailThreadStar);
const mockedSetArchived = vi.mocked(setEmailThreadArchived);

beforeEach(() => {
  vi.clearAllMocks();
  mockedToggleStar.mockResolvedValue({ ok: true, isStarred: true });
  mockedSetArchived.mockResolvedValue({ ok: true });
});

describe("ThreadRowActions — star", () => {
  test("click stars optimistically and calls the action with the thread id", async () => {
    const user = userEvent.setup();
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Star thread" }));

    // Optimistic: label flips before/without waiting on the server.
    expect(
      screen.getByRole("button", { name: "Unstar thread" })
    ).toBeInTheDocument();
    expect(mockedToggleStar).toHaveBeenCalledExactlyOnceWith("t1");
  });

  test("starred thread renders the unstar affordance and toggles off", async () => {
    const user = userEvent.setup();
    mockedToggleStar.mockResolvedValue({ ok: true, isStarred: false });
    render(
      <ThreadRowActions threadId="t1" isStarred={true} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Unstar thread" }));
    expect(
      screen.getByRole("button", { name: "Star thread" })
    ).toBeInTheDocument();
  });

  test("reverts the optimistic star when the action refuses", async () => {
    const user = userEvent.setup();
    mockedToggleStar.mockResolvedValue({ ok: false });
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Star thread" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Star thread" })
      ).toBeInTheDocument();
    });
  });
});

describe("ThreadRowActions — archive", () => {
  test("unarchived row archives (archived: true)", async () => {
    const user = userEvent.setup();
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Archive thread" }));
    await waitFor(() => {
      expect(mockedSetArchived).toHaveBeenCalledExactlyOnceWith("t1", true);
    });
  });

  test("archived row offers unarchive (archived: false)", async () => {
    const user = userEvent.setup();
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={true} />
    );

    await user.click(
      screen.getByRole("button", { name: "Unarchive thread" })
    );
    await waitFor(() => {
      expect(mockedSetArchived).toHaveBeenCalledExactlyOnceWith("t1", false);
    });
  });
});
