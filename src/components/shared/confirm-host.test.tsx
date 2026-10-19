import { describe, expect, test } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { confirmAction } from "@/lib/feedback";
import { ConfirmHost } from "./confirm-host";

describe("confirmAction + ConfirmHost", () => {
  test("resolves false without a mounted host", async () => {
    await expect(confirmAction({ title: "Delete?" })).resolves.toBe(false);
  });

  test("resolves true when the confirm button is clicked", async () => {
    render(<ConfirmHost />);
    let result: Promise<boolean> = Promise.resolve(false);
    act(() => {
      result = confirmAction({
        title: "Delete this note?",
        description: "This can't be undone.",
        confirmLabel: "Delete note",
        destructive: true,
      });
    });
    expect(await screen.findByText("Delete this note?")).toBeTruthy();
    expect(screen.getByText("This can't be undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    await expect(result).resolves.toBe(true);
  });

  test("resolves false on cancel", async () => {
    render(<ConfirmHost />);
    let result: Promise<boolean> = Promise.resolve(true);
    act(() => {
      result = confirmAction({ title: "Remove?" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await expect(result).resolves.toBe(false);
  });

  test("a second request cancels the first", async () => {
    render(<ConfirmHost />);
    let first: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = confirmAction({ title: "First?" });
    });
    await screen.findByText("First?");
    act(() => {
      void confirmAction({ title: "Second?" });
    });
    await expect(first).resolves.toBe(false);
    await waitFor(() => expect(screen.getByText("Second?")).toBeTruthy());
  });
});
