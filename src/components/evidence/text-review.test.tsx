/**
 * Tests for TextReview's quote-relocation timing — specifically the
 * `awaitContentReady` wiring added for the async docx-preview body.
 *
 * ReviewPanel is mocked to a passthrough: these tests are about WHEN
 * TextReview walks the container for the ?flag= deep-link quote, not
 * about the rail/composer UI. The success signal we assert on is the
 * scrollIntoView call navigateToQuote makes on the matched text
 * node's parent (happy-dom implements it as a no-op, so a spy on the
 * prototype is the observable); the failure signal is the visible
 * "quote not found" notice.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { TextReview } from "./text-review";
import { VIEWER_CONTENT_READY_EVENT } from "@/components/documents-viewer/content-ready-event";

vi.mock("./review-panel", () => ({
  ReviewPanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const BASE_PROPS = {
  documentId: "doc-1",
  moments: [],
  currentUserId: "u1",
  canCreate: false,
  canEditAny: false,
  canDeleteAny: false,
};

let scrollSpy: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  scrollSpy = vi.fn<() => void>();
  Element.prototype.scrollIntoView = scrollSpy;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Wait a couple of animation frames so a relocation that WOULD have
 *  run (rAF-deferred) has had every chance to. */
const settleFrames = () =>
  act(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

describe("TextReview — initialQuote relocation timing", () => {
  test("default (server-rendered body): relocates on mount", async () => {
    render(
      <TextReview {...BASE_PROPS} initialQuote="brown fox">
        <p>The quick brown fox jumps over the lazy dog.</p>
      </TextReview>
    );
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
  });

  test("awaitContentReady: does NOT relocate until the body announces readiness", async () => {
    const { container } = render(
      <TextReview {...BASE_PROPS} initialQuote="brown fox" awaitContentReady>
        <div data-testid="async-body">
          The quick brown fox jumps over the lazy dog.
        </div>
      </TextReview>
    );
    await settleFrames();
    // Text is present, but no ready event yet — the deferred path
    // must not have walked the container.
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/quote not found in the current render/i)
    ).toBeNull();

    // The async body announces (bubbling, like DocxPreviewRenderer).
    act(() => {
      container
        .querySelector('[data-testid="async-body"]')!
        .dispatchEvent(
          new CustomEvent(VIEWER_CONTENT_READY_EVENT, { bubbles: true })
        );
    });
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
  });

  test("awaitContentReady: quote genuinely missing after readiness → visible notice, no spurious early notice", async () => {
    const { container } = render(
      <TextReview {...BASE_PROPS} initialQuote="never in the render" awaitContentReady>
        <div data-testid="async-body">Completely different text.</div>
      </TextReview>
    );
    await settleFrames();
    expect(
      screen.queryByText(/quote not found in the current render/i)
    ).toBeNull();

    act(() => {
      container
        .querySelector('[data-testid="async-body"]')!
        .dispatchEvent(
          new CustomEvent(VIEWER_CONTENT_READY_EVENT, { bubbles: true })
        );
    });
    await waitFor(() =>
      expect(
        screen.getByText(/quote not found in the current render/i)
      ).toBeInTheDocument()
    );
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  test("no initialQuote: ready events are ignored entirely", async () => {
    const { container } = render(
      <TextReview {...BASE_PROPS} initialQuote={null} awaitContentReady>
        <div data-testid="async-body">Some text.</div>
      </TextReview>
    );
    act(() => {
      container
        .querySelector('[data-testid="async-body"]')!
        .dispatchEvent(
          new CustomEvent(VIEWER_CONTENT_READY_EVENT, { bubbles: true })
        );
    });
    await settleFrames();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/quote not found in the current render/i)
    ).toBeNull();
  });
});
