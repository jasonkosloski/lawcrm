/**
 * ReviewPanel layout: the default viewer-then-rail layout, and the
 * transcript-first layout media uses once a recording has a transcript.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./moments-rail", () => ({
  MomentsRail: () => <div data-testid="rail" />,
}));
vi.mock("./flag-composer", () => ({ FlagComposer: () => <div /> }));

import { ReviewPanel } from "./review-panel";

const props = {
  documentId: "d1",
  moments: [],
  currentUserId: "u1",
  canCreate: true,
  canEditAny: false,
  canDeleteAny: false,
  captureLabel: "Flag this moment",
  captureAnchor: () => ({ kind: "time" as const, timeSeconds: 0 }),
  composerAnchor: null,
  onComposerAnchorChange: () => {},
  emptyHint: "",
};

const follows = (a: HTMLElement, b: HTMLElement) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("ReviewPanel", () => {
  test("default: viewer, then the capture button, then the rail", () => {
    render(
      <ReviewPanel {...props}>
        <div data-testid="body" />
      </ReviewPanel>
    );
    const body = screen.getByTestId("body");
    const capture = screen.getByRole("button", { name: /Flag this moment/ });
    expect(follows(body, capture)).toBe(true);
    expect(follows(capture, screen.getByTestId("rail"))).toBe(true);
  });

  test("with an aside: player and capture share the side column; the transcript fills the main column", () => {
    render(
      <ReviewPanel {...props} aside={<div data-testid="player" />}>
        <div data-testid="transcript" />
      </ReviewPanel>
    );
    const player = screen.getByTestId("player");
    const transcript = screen.getByTestId("transcript");
    const capture = screen.getByRole("button", { name: /Flag this moment/ });
    const rail = screen.getByTestId("rail");

    // Small-screen stack order: player, transcript, flags.
    expect(follows(player, transcript)).toBe(true);
    expect(follows(transcript, rail)).toBe(true);
    // Capture sits with the player, not under the transcript.
    expect(player.parentElement).toBe(capture.closest("div")!.parentElement);
    // Desktop: transcript spans both rows of the main column.
    expect(transcript.parentElement).toHaveClass("lg:col-start-1", "lg:row-span-2");
    expect(rail.parentElement).toHaveClass("lg:col-start-2", "lg:row-start-2");
  });
});
