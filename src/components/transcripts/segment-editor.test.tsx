/**
 * Corrections UI: paragraph editor, speaker chip, show original / revert,
 * and edit mode gating.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("@/app/actions/transcripts", () => ({
  requestTranscript: vi.fn(),
  deleteTranscript: vi.fn(),
  updateTranscriptSegment: vi.fn(),
  revertTranscriptSegment: vi.fn(),
  setSegmentSpeaker: vi.fn(),
  renameTranscriptSpeaker: vi.fn(),
}));
vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

import {
  renameTranscriptSpeaker,
  revertTranscriptSegment,
  setSegmentSpeaker,
  updateTranscriptSegment,
} from "@/app/actions/transcripts";
import type { TranscriptView } from "@/lib/queries/transcript";
import { TranscriptPane } from "./transcript-pane";

type Seg = TranscriptView["segments"][number];
function seg(i: number, speaker: string, start: number, text: string, extra: Partial<Seg> = {}): Seg {
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
    revision: 4,
    ...extra,
  };
}
const T: TranscriptView = {
  id: "t1",
  status: "completed",
  error: null,
  durationSeconds: null,
  completedAt: null,
  correctedAt: null,
  correctedByName: null,
  speakers: { A: "Officer Diaz", B: "Speaker B" },
  segments: [
    seg(0, "A", 3, "the officer arrived"),
    seg(1, "B", 20, "it was dark", { originalText: "it was dork" }),
  ],
};

function pane(over: Partial<React.ComponentProps<typeof TranscriptPane>> = {}) {
  return render(
    <TranscriptPane
      transcript={T}
      documentId="doc1"
      documentName="Bodycam.mp4"
      currentTime={0}
      onSeek={vi.fn()}
      flags={[]}
      canTranscribe={false}
      canDelete={false}
      canEdit
      durationSeconds={null}
      {...over}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("edit mode gating", () => {
  test("no edit controls without canEdit", () => {
    pane({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Edit transcript" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit paragraph/ })).toBeNull();
  });

  test("no Edit toggle while the transcript is not completed", () => {
    pane({ transcript: { ...T, status: "processing" } });
    expect(screen.queryByRole("button", { name: "Edit transcript" })).toBeNull();
  });

  test("pencils appear only after toggling Edit", () => {
    pane();
    expect(screen.queryByRole("button", { name: /Edit paragraph/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit transcript" }));
    expect(screen.getAllByRole("button", { name: /Edit paragraph/ })).toHaveLength(2);
  });
});

describe("paragraph editor", () => {
  async function openEditor() {
    pane();
    fireEvent.click(screen.getByRole("button", { name: "Edit transcript" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Edit paragraph/ })[0]);
    return screen.getByRole("textbox", { name: "Paragraph text" }) as HTMLTextAreaElement;
  }

  test("Save calls updateTranscriptSegment with the revision", async () => {
    vi.mocked(updateTranscriptSegment).mockResolvedValue({ ok: true, revision: 5 });
    const box = await openEditor();
    expect(box.value).toBe("the officer arrived");
    fireEvent.change(box, { target: { value: "the officer arrives" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateTranscriptSegment).toHaveBeenCalledWith("seg0", {
        text: "the officer arrives",
        revision: 4,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Paragraph text" })).toBeNull());
  });

  async function conflictOnce() {
    vi.mocked(updateTranscriptSegment).mockResolvedValueOnce({
      ok: false,
      conflict: true,
      error: "Someone else changed this paragraph. Reload to see their version.",
      current: { text: "the officer arrived late", revision: 7 },
    });
    const box = await openEditor();
    fireEvent.change(box, { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Someone else changed this paragraph.");
  }

  test("a conflict refreshes and shows their version, keeping the typed text", async () => {
    await conflictOnce();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Their version")).toBeTruthy();
    expect(screen.getByText("the officer arrived late")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Paragraph text" }) as HTMLTextAreaElement).value).toBe("changed");
    // Plain Save is not available until a choice is made.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(updateTranscriptSegment).toHaveBeenCalledTimes(1);
  });

  test("Use theirs re-seeds the textarea and saves against the new revision", async () => {
    await conflictOnce();
    fireEvent.click(screen.getByRole("button", { name: "Use theirs" }));
    expect(screen.queryByText("Their version")).toBeNull();
    const box = screen.getByRole("textbox", { name: "Paragraph text" }) as HTMLTextAreaElement;
    expect(box.value).toBe("the officer arrived late");
    expect(updateTranscriptSegment).toHaveBeenCalledTimes(1);
    vi.mocked(updateTranscriptSegment).mockResolvedValueOnce({ ok: true, revision: 8 });
    fireEvent.change(box, { target: { value: "the officer arrived late today" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateTranscriptSegment).toHaveBeenLastCalledWith("seg0", {
        text: "the officer arrived late today",
        revision: 7,
      }),
    );
  });

  test("Keep mine and save is the explicit overwrite against the new revision", async () => {
    await conflictOnce();
    vi.mocked(updateTranscriptSegment).mockResolvedValueOnce({ ok: true, revision: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Keep mine and save" }));
    await waitFor(() =>
      expect(updateTranscriptSegment).toHaveBeenLastCalledWith("seg0", {
        text: "changed",
        revision: 7,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Paragraph text" })).toBeNull());
  });

  test("another error shows inline and keeps the editor open", async () => {
    vi.mocked(updateTranscriptSegment).mockResolvedValue({ ok: false, error: "A paragraph can't be empty." });
    await openEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Paragraph text" }), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("A paragraph can't be empty.");
  });

  test("Cancel closes without saving", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Paragraph text" })).toBeNull();
    expect(updateTranscriptSegment).not.toHaveBeenCalled();
  });
});

describe("show original / revert", () => {
  test("Show original reveals the muted original; Revert calls the action", async () => {
    vi.mocked(revertTranscriptSegment).mockResolvedValue({ ok: true, revision: 5 });
    pane();
    expect(screen.queryByText("it was dork")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(screen.getByText("it was dork")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(revertTranscriptSegment).toHaveBeenCalledWith("seg1", 4));
  });

  test("Revert is hidden without canEdit", () => {
    pane({ canEdit: false });
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });
});

describe("speaker chip", () => {
  async function openChip(user: ReturnType<typeof userEvent.setup>, name: string) {
    fireEvent.click(screen.getByRole("button", { name: "Edit transcript" }));
    await user.click(screen.getByRole("button", { name: `Speaker: ${name}` }));
  }

  test("Rename… opens a dialog and calls renameTranscriptSpeaker", async () => {
    vi.mocked(renameTranscriptSpeaker).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    pane();
    await openChip(user, "Speaker B");
    await user.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    const input = await screen.findByRole("textbox", { name: "Speaker name" });
    fireEvent.change(input, { target: { value: "Witness" } });
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(renameTranscriptSpeaker).toHaveBeenCalledWith("t1", "B", "Witness"));
  });

  test("changing a paragraph's speaker calls setSegmentSpeaker; New speaker takes the next letter", async () => {
    vi.mocked(setSegmentSpeaker).mockResolvedValue({ ok: true, revision: 5 });
    const user = userEvent.setup();
    pane();
    await openChip(user, "Speaker B");
    await user.click(await screen.findByRole("menuitem", { name: "Change speaker for this paragraph" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "New speaker" }));
    await waitFor(() => expect(setSegmentSpeaker).toHaveBeenCalledWith("seg1", "C", 4));
  });
});
