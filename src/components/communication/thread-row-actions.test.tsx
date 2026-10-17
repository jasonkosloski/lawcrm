/**
 * Component tests for the thread-row star/archive cluster.
 *
 * Server actions are stubbed at module level (the layer-2 pattern);
 * what's pinned here is the optimistic star flip + revert-on-failure
 * (including a REJECTED action), that star posts the explicit state
 * the user chose (not a toggle), and the archive/unarchive wiring
 * (right threadId, right direction, refresh + error on failure).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/email-thread-flags", () => ({
  setEmailThreadStarred: vi.fn(),
  setEmailThreadArchived: vi.fn(),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import {
  setEmailThreadArchived,
  setEmailThreadStarred,
} from "@/app/actions/email-thread-flags";
import { ThreadRowActions } from "./thread-row-actions";

const mockedSetStarred = vi.mocked(setEmailThreadStarred);
const mockedSetArchived = vi.mocked(setEmailThreadArchived);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSetStarred.mockResolvedValue({ ok: true, isStarred: true });
  mockedSetArchived.mockResolvedValue({ ok: true });
});

describe("ThreadRowActions — star", () => {
  test("click stars optimistically and posts the explicit state (true), not a toggle", async () => {
    const user = userEvent.setup();
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Star thread" }));

    // Optimistic: label flips before/without waiting on the server.
    expect(
      screen.getByRole("button", { name: "Unstar thread" })
    ).toBeInTheDocument();
    expect(mockedSetStarred).toHaveBeenCalledExactlyOnceWith("t1", true);
  });

  test("starred thread renders the unstar affordance and posts false", async () => {
    const user = userEvent.setup();
    mockedSetStarred.mockResolvedValue({ ok: true, isStarred: false });
    render(
      <ThreadRowActions threadId="t1" isStarred={true} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Unstar thread" }));
    expect(
      screen.getByRole("button", { name: "Star thread" })
    ).toBeInTheDocument();
    expect(mockedSetStarred).toHaveBeenCalledExactlyOnceWith("t1", false);
  });

  test("reverts the optimistic star when the action refuses", async () => {
    const user = userEvent.setup();
    mockedSetStarred.mockResolvedValue({ ok: false });
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Star thread" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Star thread" })
      ).toBeInTheDocument();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't update the star/i
    );
    // The cluster stays visible (not hover-only) while an error shows.
    expect(screen.getByRole("alert").parentElement!.className).toContain(
      "opacity-100 pointer-events-auto"
    );
  });

  test("a REJECTED action reverts the star and shows an error (no unhandled rejection)", async () => {
    const user = userEvent.setup();
    mockedSetStarred.mockRejectedValue(new Error("network down"));
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Star thread" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Star thread" })
      ).toBeInTheDocument();
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("ThreadRowActions — archive", () => {
  test("unarchived row archives (archived: true) and refreshes", async () => {
    const user = userEvent.setup();
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Archive thread" }));
    await waitFor(() => {
      expect(mockedSetArchived).toHaveBeenCalledExactlyOnceWith("t1", true);
    });
    // The server no-ops WITHOUT revalidating on a stale row, so the
    // client must refresh to correct it.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
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

  test("a failed archive ({ ok: false }) shows a message and does not refresh", async () => {
    const user = userEvent.setup();
    mockedSetArchived.mockResolvedValue({ ok: false });
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Archive thread" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't update this thread/i
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a rejected archive shows a message instead of throwing", async () => {
    const user = userEvent.setup();
    mockedSetArchived.mockRejectedValue(new Error("boom"));
    render(
      <ThreadRowActions threadId="t1" isStarred={false} isArchived={false} />
    );

    await user.click(screen.getByRole("button", { name: "Archive thread" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
