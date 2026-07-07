/**
 * Tests for the MarkThreadRead island.
 *
 * The component's whole job is effect discipline: fire the RIGHT
 * channel's action exactly once per thread open, and re-fire only
 * when the threadId changes (switching threads inside the same
 * mounted reader pane). Server actions are mocked — the DB side is
 * covered by thread-read.test.ts.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { MarkThreadRead } from "./mark-thread-read";

vi.mock("@/app/actions/thread-read", () => ({
  markEmailThreadRead: vi.fn().mockResolvedValue({ ok: true }),
  markMessengerThreadRead: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  markEmailThreadRead,
  markMessengerThreadRead,
} from "@/app/actions/thread-read";

const mockedEmail = vi.mocked(markEmailThreadRead);
const mockedMessenger = vi.mocked(markMessengerThreadRead);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MarkThreadRead", () => {
  test("email channel fires markEmailThreadRead once with the thread id", () => {
    render(<MarkThreadRead channel="email" threadId="t-1" />);
    expect(mockedEmail).toHaveBeenCalledTimes(1);
    expect(mockedEmail).toHaveBeenCalledWith("t-1");
    expect(mockedMessenger).not.toHaveBeenCalled();
  });

  test("messenger channel fires markMessengerThreadRead once with the thread id", () => {
    render(<MarkThreadRead channel="messenger" threadId="mt-1" />);
    expect(mockedMessenger).toHaveBeenCalledTimes(1);
    expect(mockedMessenger).toHaveBeenCalledWith("mt-1");
    expect(mockedEmail).not.toHaveBeenCalled();
  });

  test("re-render with the SAME threadId does not re-fire", () => {
    const { rerender } = render(
      <MarkThreadRead channel="email" threadId="t-1" />
    );
    rerender(<MarkThreadRead channel="email" threadId="t-1" />);
    expect(mockedEmail).toHaveBeenCalledTimes(1);
  });

  test("switching to a different threadId fires again for the new thread", () => {
    const { rerender } = render(
      <MarkThreadRead channel="email" threadId="t-1" />
    );
    rerender(<MarkThreadRead channel="email" threadId="t-2" />);
    expect(mockedEmail).toHaveBeenCalledTimes(2);
    expect(mockedEmail).toHaveBeenLastCalledWith("t-2");
  });

  test("a rejected action is swallowed — the reader never crashes", async () => {
    mockedEmail.mockRejectedValueOnce(new Error("network"));
    render(<MarkThreadRead channel="email" threadId="t-err" />);
    // Flush the rejected promise chain; an unhandled rejection here
    // would fail the test run.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockedEmail).toHaveBeenCalledWith("t-err");
  });

  test("renders nothing", () => {
    const { container } = render(
      <MarkThreadRead channel="email" threadId="t-1" />
    );
    expect(container.innerHTML).toBe("");
  });
});
