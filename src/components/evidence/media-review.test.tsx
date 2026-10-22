/**
 * MediaReview layout choice: transcript-first only when there is
 * transcript text to read.
 */

import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import type { TranscriptView } from "@/lib/queries/transcript";

vi.mock("./review-panel", () => ({
  ReviewPanel: ({ aside, children }: { aside?: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <div data-testid="aside">{aside}</div>
      <div data-testid="main">{children}</div>
    </div>
  ),
}));
vi.mock("@/components/documents-viewer/video-player", () => ({
  VideoPlayer: () => <div data-testid="player" />,
}));
vi.mock("@/components/documents-viewer/audio-player", () => ({ AudioPlayer: () => null }));
vi.mock("@/components/transcripts/media-transcript", () => ({
  MediaTranscript: () => <div data-testid="transcript" />,
}));
vi.mock("@/components/transcripts/selection-toolbar", () => ({ spanToComposerAnchor: vi.fn() }));

import { MediaReview } from "./media-review";

const transcript = (segments: number): TranscriptView =>
  ({
    id: "t1",
    status: "completed",
    segments: Array.from({ length: segments }, (_, i) => ({ id: `s${i}` })),
  }) as unknown as TranscriptView;

const renderWith = (t: TranscriptView | null) =>
  render(
    <MediaReview
      kind="video"
      src="/x.mp4"
      name="x.mp4"
      documentId="d1"
      initialSeconds={null}
      moments={[]}
      currentUserId="u1"
      canCreate
      canEditAny={false}
      canDeleteAny={false}
      transcript={t}
      canTranscribe
      transcriptionConfigured
      canDeleteTranscript={false}
      canEditTranscript={false}
    />
  );

describe("MediaReview layout", () => {
  test("transcript text → player moves to the side column", () => {
    const { getByTestId } = renderWith(transcript(3));
    expect(getByTestId("aside")).toContainElement(getByTestId("player"));
    expect(getByTestId("main")).toContainElement(getByTestId("transcript"));
  });

  test.each([
    ["no transcript yet", null],
    ["no speech detected", transcript(0)],
  ])("%s → big-player layout", (_label, t) => {
    const { getByTestId } = renderWith(t);
    expect(getByTestId("aside")).toBeEmptyDOMElement();
    expect(getByTestId("main")).toContainElement(getByTestId("player"));
    expect(getByTestId("main")).toContainElement(getByTestId("transcript"));
  });
});
