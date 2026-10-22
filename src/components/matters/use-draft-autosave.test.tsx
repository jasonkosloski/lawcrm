import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/app/actions/matter-drafts", () => ({ saveMatterDraft: vi.fn() }));

import { saveMatterDraft } from "@/app/actions/matter-drafts";
import { AUTOSAVE_INTERVAL_MS, useDraftAutosave } from "./use-draft-autosave";

const save = vi.mocked(saveMatterDraft);
const T1 = "2026-10-20T10:00:00.000Z";
const T2 = "2026-10-20T10:00:30.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset();
});
afterEach(() => vi.useRealTimers());

function setup(
  over: Partial<Parameters<typeof useDraftAutosave>[0]> = {},
  values: { current: Record<string, string> } = { current: { name: "A" } },
) {
  const hook = renderHook(
    (props: Parameters<typeof useDraftAutosave>[0]) => useDraftAutosave(props),
    {
      initialProps: {
        draftId: "d1",
        updatedAt: T1,
        getValues: () => values.current,
        paused: false,
        ...over,
      },
    },
  );
  return { hook, values };
}

const tick = () => act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS));

describe("useDraftAutosave", () => {
  test("saveNow with no draft creates one and returns its id", async () => {
    save.mockResolvedValue({ ok: true, draftId: "new1", updatedAt: T1 });
    const { hook } = setup({ draftId: null, updatedAt: null });
    let id: string | null = null;
    await act(async () => {
      id = await hook.result.current.saveNow();
    });
    expect(id).toBe("new1");
    expect(save).toHaveBeenCalledWith(null, null, { name: "A" });
    expect(hook.result.current.status).toBe("saved");
    expect(hook.result.current.draftId).toBe("new1");
    expect(hook.result.current.savedAt).toEqual(new Date(T1));
  });

  test("never auto-creates: with no draft the timer does nothing", async () => {
    const { hook } = setup({ draftId: null, updatedAt: null });
    await tick();
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
  });

  test("auto-saves only when the values changed, sending the last updatedAt", async () => {
    save.mockResolvedValueOnce({ ok: true, draftId: "d1", updatedAt: T2 });
    const { hook, values } = setup();
    await tick();
    expect(save).not.toHaveBeenCalled(); // unchanged since mount

    values.current = { name: "B" };
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("d1", T1, { name: "B" });
    expect(hook.result.current.status).toBe("saved");
    expect(hook.result.current.updatedAt).toBe(T2);

    await tick();
    expect(save).toHaveBeenCalledTimes(1); // unchanged again
  });

  test("paused (Create in flight): auto-save does not fire", async () => {
    const { hook, values } = setup({ paused: true });
    values.current = { name: "B" };
    await tick();
    expect(save).not.toHaveBeenCalled();

    hook.rerender({
      draftId: "d1",
      updatedAt: T1,
      getValues: () => values.current,
      paused: false,
    });
    save.mockResolvedValue({ ok: true, draftId: "d1", updatedAt: T2 });
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("notfound -> gone, and saving stops (nothing is re-created)", async () => {
    save.mockResolvedValue({ ok: false, code: "notfound" });
    const { hook, values } = setup();
    values.current = { name: "B" };
    await tick();
    expect(hook.result.current.status).toBe("gone");
    values.current = { name: "C" };
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
    let id: string | null = "x";
    await act(async () => {
      id = await hook.result.current.saveNow();
    });
    expect(id).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("stale -> stale status and saving stops", async () => {
    save.mockResolvedValue({ ok: false, code: "stale" });
    const { hook, values } = setup();
    values.current = { name: "B" };
    await tick();
    expect(hook.result.current.status).toBe("stale");
    values.current = { name: "C" };
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("a save that throws (network) is not fatal: error status, next change retries", async () => {
    save.mockRejectedValueOnce(new Error("offline"));
    save.mockResolvedValueOnce({ ok: true, draftId: "d1", updatedAt: T2 });
    const { hook, values } = setup();
    values.current = { name: "B" };
    await tick();
    expect(hook.result.current.status).toBe("error");
    await tick();
    expect(hook.result.current.status).toBe("saved");
  });

  test("a failed manual save shows the error status; a thrown auto-save error retries", async () => {
    save.mockRejectedValueOnce(new Error("offline"));
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.saveNow();
    });
    expect(hook.result.current.status).toBe("error");
  });

  test("invalid -> invalid status and auto-save stops", async () => {
    save.mockResolvedValue({ ok: false, code: "invalid" });
    const { hook, values } = setup();
    values.current = { name: "B" };
    await tick();
    expect(hook.result.current.status).toBe("invalid");
    values.current = { name: "C" };
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
