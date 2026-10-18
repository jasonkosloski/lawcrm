/**
 * PdfReview — the wiring between the built-in PDF viewer and flags.
 *
 * The viewer (pdf.js) is mocked to a fake that renders each page's
 * "text layer" as plain spans inside a `[data-page-number]` wrapper,
 * exactly the DOM shape PdfReview reads, and exposes a spy handle.
 * ReviewPanel is mocked to surface what PdfReview hands it: the
 * composer anchor it seeds, the capture button, and a click-through
 * per flag. What's pinned:
 *   - selecting text on a page seeds a PAGE + QUOTE anchor, with a
 *     heads-up when the passage repeats on that page
 *   - clicking a passage flag highlights it on its page; a passage
 *     that no longer matches lands on the page with a visible notice
 *   - a page-only flag just goes to the page
 *   - "Flag this page" prefills the viewer's current page
 *   - a ?flag= deep link focuses its passage once the PDF is ready
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComposerAnchor } from "./flag-composer";
import type { RailMoment } from "./moments-rail";

const handle = {
  goToPage: vi.fn(),
  currentPage: vi.fn(() => 2),
  pageTextLayer: vi.fn(async (page: number) =>
    document.querySelector<HTMLElement>(`[data-page-number="${page}"] .textLayer`)
  ),
};

const PAGES: Record<number, string[]> = {
  1: ["Deposition of Officer Smith", "Where were you that night?"],
  2: ["Exhibit 4: bodycam footage", "The light was red.", "The light was red."],
};

vi.mock("@/components/documents-viewer/pdf-document-viewer", async () => {
  const React = await import("react");
  return {
    PdfDocumentViewer: ({
      ref,
      onReady,
    }: {
      ref: React.Ref<typeof handle>;
      onReady?: (n: number) => void;
    }) => {
      React.useImperativeHandle(ref, () => handle);
      React.useEffect(() => {
        onReady?.(2);
      }, [onReady]);
      return (
        <div>
          {Object.entries(PAGES).map(([n, lines]) => (
            <div key={n} data-page-number={n}>
              <div className="textLayer">
                {lines.map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    },
  };
});

let lastAnchor: ComposerAnchor | null = null;
vi.mock("./review-panel", () => ({
  ReviewPanel: (props: {
    children: React.ReactNode;
    moments: RailMoment[];
    captureLabel: string;
    captureAnchor: () => ComposerAnchor;
    composerAnchor: ComposerAnchor | null;
    onComposerAnchorChange: (a: ComposerAnchor | null) => void;
    onNavigate?: (m: RailMoment) => void;
  }) => {
    lastAnchor = props.composerAnchor;
    return (
      <div>
        <button type="button" onClick={() => props.onComposerAnchorChange(props.captureAnchor())}>
          {props.captureLabel}
        </button>
        {props.moments.map((m) => (
          <button key={m.id} type="button" onClick={() => props.onNavigate?.(m)}>
            go {m.id}
          </button>
        ))}
        {props.children}
      </div>
    );
  },
}));

import { PdfReview } from "./pdf-review";

const moment = (over: Partial<RailMoment>): RailMoment => ({
  id: "f",
  timeSeconds: null,
  endSeconds: null,
  pageNumber: null,
  quote: null,
  category: "emphasis",
  description: "note",
  flaggedById: "u1",
  flaggedByInitials: "JK",
  flaggedByName: "J K",
  ...over,
});

const BASE = {
  src: "/api/documents/d1/download",
  name: "depo.pdf",
  documentId: "d1",
  initialPage: null,
  currentUserId: "u1",
  canCreate: true,
  canEditAny: false,
  canDeleteAny: false,
};

let scrollSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  lastAnchor = null;
  scrollSpy = vi.fn();
  Element.prototype.scrollIntoView = scrollSpy as unknown as Element["scrollIntoView"];
  vi.clearAllMocks();
});
afterEach(() => {
  window.getSelection()?.removeAllRanges();
});

/** Select the text of one span and announce it like a browser would. */
function selectSpan(text: string, nth = 0) {
  const span = screen.getAllByText(text)[nth];
  const range = document.createRange();
  range.selectNodeContents(span);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

describe("PdfReview — capture", () => {
  test("a selection on a page becomes a page + quote anchor", async () => {
    render(<PdfReview {...BASE} moments={[]} />);
    selectSpan("Exhibit 4: bodycam footage");
    fireEvent.click(screen.getByRole("button", { name: "Flag selection" }));
    await waitFor(() =>
      expect(lastAnchor).toEqual({
        kind: "page",
        pageNumber: 2,
        quote: "Exhibit 4: bodycam footage",
        hint: undefined,
      })
    );
  });

  test("a passage that repeats on its page carries a heads-up", async () => {
    render(<PdfReview {...BASE} moments={[]} />);
    selectSpan("The light was red.", 1);
    fireEvent.click(screen.getByRole("button", { name: "Flag selection" }));
    await waitFor(() => expect(lastAnchor?.kind).toBe("page"));
    expect(lastAnchor).toMatchObject({ pageNumber: 2, quote: "The light was red." });
    expect(lastAnchor && "hint" in lastAnchor && lastAnchor.hint).toMatch(/appears 2 times on page 2/);
  });

  test("“Flag this page” prefills the page under the reading line", () => {
    render(<PdfReview {...BASE} moments={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Flag this page" }));
    expect(lastAnchor).toEqual({ kind: "page", pageNumber: 2 });
  });

  test("no create permission → no selection affordance", () => {
    render(<PdfReview {...BASE} canCreate={false} moments={[]} />);
    selectSpan("Exhibit 4: bodycam footage");
    expect(screen.queryByRole("button", { name: "Flag selection" })).toBeNull();
  });
});

describe("PdfReview — navigate", () => {
  test("a passage flag scrolls to and highlights its text on its page", async () => {
    render(
      <PdfReview {...BASE} moments={[moment({ id: "p", pageNumber: 2, quote: "bodycam footage" })]} />
    );
    fireEvent.click(screen.getByRole("button", { name: "go p" }));
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(handle.pageTextLayer).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a passage that no longer matches lands on the page and says so", async () => {
    render(
      <PdfReview {...BASE} moments={[moment({ id: "gone", pageNumber: 1, quote: "bodycam footage" })]} />
    );
    fireEvent.click(screen.getByRole("button", { name: "go gone" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/not found on page 1/i);
    expect(handle.goToPage).toHaveBeenCalledWith(1);
  });

  test("a page-only flag just goes to the page", () => {
    render(<PdfReview {...BASE} moments={[moment({ id: "pg", pageNumber: 1 })]} />);
    fireEvent.click(screen.getByRole("button", { name: "go pg" }));
    expect(handle.goToPage).toHaveBeenCalledWith(1);
    expect(handle.pageTextLayer).not.toHaveBeenCalled();
  });

  test("a ?flag= deep link focuses its passage once the PDF is ready", async () => {
    render(<PdfReview {...BASE} initialPage={2} initialQuote="Exhibit 4" moments={[]} />);
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(handle.pageTextLayer).toHaveBeenCalledWith(2);
  });
});
