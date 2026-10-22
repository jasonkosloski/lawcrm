/**
 * TranscriptPane — sync, seek, highlights, find, status UI, menu, and the
 * 400-segment render budget (Review Focus 5).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("@/app/actions/transcripts", () => ({
  requestTranscript: vi.fn(),
  deleteTranscript: vi.fn(),
  revertTranscriptSegment: vi.fn(),
  updateTranscriptSegment: vi.fn(),
  setSegmentSpeaker: vi.fn(),
  renameTranscriptSpeaker: vi.fn(),
}));
vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(),
  notifyError: vi.fn(),
}));

import { requestTranscript, deleteTranscript } from "@/app/actions/transcripts";
import { confirmAction, notifyError } from "@/lib/feedback";
import type { TranscriptView } from "@/lib/queries/transcript";
import { TranscriptPane } from "./transcript-pane";

type Seg = TranscriptView["segments"][number];

function seg(i: number, speaker: string, start: number, text: string): Seg {
  const words = text.split(" ").map((w, k) => ({ w, s: start + k, e: start + k + 1 }));
  return {
    id: `seg${i}`,
    index: i,
    speaker,
    startSeconds: start,
    endSeconds: start + words.length,
    text,
    words,
    originalText: null,
    revision: 0,
  };
}

const BASE: TranscriptView = {
  id: "t1",
  status: "completed",
  error: null,
  durationSeconds: null,
  completedAt: null,
  correctedAt: null,
  correctedByName: null,
  speakers: { A: "Officer Diaz", B: "Speaker B" },
  segments: [
    seg(0, "A", 3, "the officer arrived at the scene"),
    seg(1, "B", 20, "which officer was that officer"),
    seg(2, "A", 40, "officer Diaz and the other officer"),
  ],
};

function pane(over: Partial<React.ComponentProps<typeof TranscriptPane>> = {}) {
  const props: React.ComponentProps<typeof TranscriptPane> = {
    transcript: BASE,
    documentId: "doc1",
    documentName: "Bodycam.mp4",
    currentTime: 0,
    onSeek: vi.fn(),
    flags: [],
    canTranscribe: true,
    canDelete: true,
    durationSeconds: 754,
    ...over,
  };
  return { props, ...render(<TranscriptPane {...props} />) };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("TranscriptPane", () => {
  test("Export PDF opens the print route in a new tab for a completed transcript", () => {
    pane();
    const a = screen.getByRole("link", { name: "Export PDF" });
    expect(a.getAttribute("href")).toBe("/print/transcripts/doc1");
    expect(a.getAttribute("target")).toBe("_blank");
  });

  test("no Export PDF while the transcript is still processing", () => {
    pane({ transcript: { ...BASE, status: "processing", segments: [] } });
    expect(screen.queryByRole("link", { name: "Export PDF" })).toBeNull();
  });

  test("renders speaker names and timecodes", () => {
    pane();
    expect(screen.getAllByText("Officer Diaz").length).toBeGreaterThan(0);
    expect(screen.getByText("Speaker B")).toBeTruthy();
    expect(screen.getByText("[00:00:03]")).toBeTruthy();
    expect(screen.getByText("[00:00:20]")).toBeTruthy();
  });

  test("currentTime marks the active word aria-current", () => {
    pane({ currentTime: 4.2 });
    const active = document.querySelectorAll('[aria-current="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe("officer");
    expect(active[0].getAttribute("data-s")).toBe("4");
    expect(active[0].getAttribute("data-e")).toBe("5");
  });

  test("clicking a word seeks to its start; the timecode seeks to the paragraph", () => {
    const { props } = pane();
    fireEvent.click(screen.getByText("scene"));
    expect(props.onSeek).toHaveBeenLastCalledWith(8);
    fireEvent.click(screen.getByText("[00:00:20]"));
    expect(props.onSeek).toHaveBeenLastCalledWith(20);
  });

  test("a span flag tints only the words in range", () => {
    pane({ flags: [{ id: "f1", timeSeconds: 4, endSeconds: 6, category: "critical" }] });
    const tinted = [...document.querySelectorAll("[data-flag-category]")].map((e) => e.textContent);
    expect(tinted).toEqual(["officer", "arrived"]);
  });

  test("a point flag renders a marker before the nearest word", () => {
    pane({ flags: [{ id: "f2", timeSeconds: 22.2, endSeconds: null, category: "emphasis" }] });
    const marker = document.querySelector('[data-flag-marker="f2"]')!;
    expect(marker).toBeTruthy();
    expect(marker.nextElementSibling?.textContent).toBe("was");
  });

  test("find counts matches, cycles with Enter and seeks to each", () => {
    const { props } = pane();
    const section = screen.getByRole("region", { name: /Transcript of/ });
    fireEvent.keyDown(section, { key: "f", ctrlKey: true });
    const input = screen.getByLabelText("Find in transcript");
    fireEvent.change(input, { target: { value: "officer" } });
    expect(screen.getByText("1 of 5")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2 of 5")).toBeTruthy();
    expect(props.onSeek).toHaveBeenLastCalledWith(21);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("1 of 5")).toBeTruthy();
  });

  test("a manual wheel scroll pauses follow and offers Resume following", () => {
    pane({ currentTime: 4.2 });
    expect(screen.queryByText("Resume following")).toBeNull();
    fireEvent.wheel(document.querySelector("[data-seg]")!.parentElement!);
    fireEvent.click(screen.getByText("Resume following"));
    expect(screen.queryByText("Resume following")).toBeNull();
  });

  test("completed with zero segments says no speech was detected", () => {
    pane({ transcript: { ...BASE, segments: [] } });
    expect(screen.getByText("No speech detected in this recording.")).toBeTruthy();
  });

  test("not configured: a disabled control explains instead of a dead button", () => {
    pane({ transcript: null, transcriptionConfigured: false });
    expect(screen.getByText("Transcription isn't set up yet.")).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Transcribe/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(requestTranscript).not.toHaveBeenCalled();
  });

  test("no transcript: Transcribe button shows the duration and requests", async () => {
    vi.mocked(requestTranscript).mockResolvedValue({ ok: true, status: "processing" });
    pane({ transcript: null });
    fireEvent.click(screen.getByRole("button", { name: "Transcribe (12:34)" }));
    await waitFor(() => expect(requestTranscript).toHaveBeenCalledWith("doc1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  test("no transcript and no permission renders nothing", () => {
    const { container } = pane({ transcript: null, canTranscribe: false });
    expect(container.textContent).toBe("");
  });

  test("failed shows the reason with Retry, above any previous text", async () => {
    vi.mocked(requestTranscript).mockResolvedValue({ ok: true, status: "processing" });
    pane({ transcript: { ...BASE, status: "failed", error: "Audio unreadable" } });
    expect(screen.getByText("Audio unreadable")).toBeTruthy();
    expect(screen.getByText("[00:00:03]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(requestTranscript).toHaveBeenCalledWith("doc1"));
  });

  test("retry over corrections confirms, then replaces", async () => {
    vi.mocked(requestTranscript)
      .mockResolvedValueOnce({ ok: false, error: "x", needsConfirm: "replace_corrections" })
      .mockResolvedValueOnce({ ok: true, status: "processing" });
    vi.mocked(confirmAction).mockResolvedValue(true);
    pane({ transcript: { ...BASE, status: "failed", error: "boom" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(requestTranscript).toHaveBeenLastCalledWith("doc1", { replaceCorrections: true }),
    );
  });

  test("polls with router.refresh while processing, and stops once completed", () => {
    vi.useFakeTimers();
    try {
      const { rerender, props } = pane({ transcript: { ...BASE, status: "processing", segments: [] } });
      expect(screen.getByRole("status")).toBeTruthy();
      act(() => void vi.advanceTimersByTime(15_000));
      expect(refresh).toHaveBeenCalledTimes(1);
      rerender(<TranscriptPane {...props} transcript={BASE} />);
      act(() => void vi.advanceTimersByTime(60_000));
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Delete transcript is hidden without permission", () => {
    pane({ canDelete: false, canTranscribe: false });
    expect(screen.queryByLabelText("Transcript options")).toBeNull();
  });

  test("Delete transcript confirms, then deletes", async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(deleteTranscript).mockResolvedValue({ ok: true });
    pane();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Transcript options"));
    await user.click(await screen.findByRole("menuitem", { name: "Delete transcript" }));
    await waitFor(() => expect(deleteTranscript).toHaveBeenCalledWith("doc1"));
    expect(confirmAction).toHaveBeenCalled();
  });

  test("declining the confirm keeps the transcript", async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    pane();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Transcript options"));
    await user.click(await screen.findByRole("menuitem", { name: "Delete transcript" }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(deleteTranscript).not.toHaveBeenCalled();
  });
});

describe("fix round 1", () => {
  const sel = (word: string) => {
    const el = [...document.querySelectorAll("[data-s]")].find((e) => e.textContent === word)!;
    const r = window.getSelection()!;
    r.removeAllRanges();
    r.setBaseAndExtent(el.firstChild!, 0, el.firstChild!, word.length);
  };

  test("failed banner renders before the previous transcript text", () => {
    pane({ transcript: { ...BASE, status: "failed", error: "Audio unreadable" } });
    const banner = screen.getByText("Audio unreadable");
    const firstText = screen.getByText("[00:00:03]");
    expect(banner.compareDocumentPosition(firstText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("Re-transcribe in the menu requests a transcript", async () => {
    vi.mocked(requestTranscript).mockResolvedValue({ ok: true, status: "processing" });
    pane();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Transcript options"));
    await user.click(await screen.findByRole("menuitem", { name: "Re-transcribe" }));
    await waitFor(() => expect(requestTranscript).toHaveBeenCalledWith("doc1"));
  });

  test("Delete is reachable for a failed transcript with no segments", async () => {
    pane({ transcript: { ...BASE, status: "failed", error: "boom", segments: [] }, canTranscribe: false });
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Transcript options"));
    expect(await screen.findByRole("menuitem", { name: "Delete transcript" })).toBeTruthy();
  });

  test("while in flight Delete shows but Re-transcribe does not", async () => {
    pane({ transcript: { ...BASE, status: "processing", segments: [] } });
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Transcript options"));
    expect(await screen.findByRole("menuitem", { name: "Delete transcript" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Re-transcribe" })).toBeNull();
  });

  test("a thrown delete or request action is reported", async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(deleteTranscript).mockRejectedValue(new Error("net"));
    pane();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Transcript options"));
    await user.click(await screen.findByRole("menuitem", { name: "Delete transcript" }));
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    vi.mocked(notifyError).mockClear();
    vi.mocked(requestTranscript).mockRejectedValue(new Error("net"));
    cleanup();
    pane({ transcript: null });
    fireEvent.click(screen.getByRole("button", { name: /Transcribe/ }));
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  test("a point flag marks only the single nearest paragraph", () => {
    // 19.5 is within 5s of words in seg0 (ends 9) no; near seg1 start 20 and seg0? only seg1 nearest
    pane({ flags: [{ id: "p", timeSeconds: 19.9, endSeconds: null, category: "emphasis" }] });
    expect(document.querySelectorAll('[data-flag-marker="p"]')).toHaveLength(1);
    expect(document.querySelector('[data-flag-marker="p"]')!.closest("[data-seg]")!.getAttribute("data-seg")).toBe("seg1");
  });

  test("Flag selection shows in the pane only with canFlag and a handler", () => {
    const { unmount } = pane({ canFlag: true, onFlagSelection: vi.fn() });
    sel("officer");
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    expect(screen.getByRole("button", { name: "Flag selection" })).toBeTruthy();
    unmount();
    pane({ canFlag: false, onFlagSelection: vi.fn() });
    sel("officer");
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    expect(screen.queryByRole("button", { name: "Flag selection" })).toBeNull();
  });

  test("keyboard scroll keys, scrollbar press and user scroll pause follow", () => {
    pane({ currentTime: 4.2 });
    const box = document.querySelector("[data-seg]")!.parentElement!;
    fireEvent.keyDown(box, { key: "PageDown" });
    expect(screen.getByText("Resume following")).toBeTruthy();
    fireEvent.click(screen.getByText("Resume following"));
    fireEvent.pointerDown(box);
    expect(screen.getByText("Resume following")).toBeTruthy();
    fireEvent.click(screen.getByText("Resume following"));
    // Past the window in which follow's own scroll events are ignored.
    const now = performance.now();
    const spy = vi.spyOn(performance, "now").mockReturnValue(now + 5000);
    try {
      fireEvent.scroll(box);
      expect(screen.getByText("Resume following")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  test("a scroll caused by follow itself does not pause it", () => {
    const { props, rerender } = pane({ currentTime: 0 });
    const box = document.querySelector("[data-seg]")!.parentElement!;
    box.scrollTo = vi.fn() as never;
    rerender(<TranscriptPane {...props} currentTime={4.2} />);
    expect(box.scrollTo).toHaveBeenCalled();
    fireEvent.scroll(box);
    expect(screen.queryByText("Resume following")).toBeNull();
  });

  test("follow does not scroll while a selection exists in the pane", () => {
    const { props, rerender } = pane({ currentTime: 0 });
    const box = document.querySelector("[data-seg]")!.parentElement!;
    box.scrollTo = vi.fn() as never;
    sel("scene");
    rerender(<TranscriptPane {...props} currentTime={4.2} />);
    expect(box.scrollTo).not.toHaveBeenCalled();
  });
});

describe("render budget", () => {
  test("with 400 segments, moving currentTime inside one segment re-renders only that segment", () => {
    const reads = new Map<string, number>();
    const segments = Array.from({ length: 400 }, (_, i) => {
      const base = seg(i, "A", i * 10, "alpha bravo charlie delta echo");
      const words = base.words;
      reads.set(base.id, 0);
      // A render of the memoized segment reads `words`; count it.
      return Object.defineProperty({ ...base }, "words", {
        get() {
          reads.set(base.id, reads.get(base.id)! + 1);
          return words;
        },
        enumerable: true,
      }) as Seg;
    });
    const t: TranscriptView = { ...BASE, segments };
    const props: React.ComponentProps<typeof TranscriptPane> = {
      transcript: t,
      documentId: "doc1",
      documentName: "Long.mp4",
      currentTime: 1010.2, // inside segment 101
      onSeek: vi.fn(),
      flags: [],
      canTranscribe: false,
      canDelete: false,
      durationSeconds: null,
    };
    const { rerender } = render(<TranscriptPane {...props} />);
    const before = new Map(reads);
    rerender(<TranscriptPane {...props} currentTime={1012.4} />);
    const changed = [...reads].filter(([id, n]) => n !== before.get(id)).map(([id]) => id);
    expect(changed).toEqual(["seg101"]);
  });
});
