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
  pageTextLayer: vi.fn(async (page: number) => layerOf(page)),
  pageTextLayers: vi.fn(async (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => layerOf(from + i)),
  ),
};
const layerOf = (page: number) =>
  document.querySelector<HTMLElement>(`[data-page-number="${page}"] .textLayer`);

const PAGES: Record<number, string[]> = {
  1: ["Deposition of Officer Smith", "Where were you that night?"],
  2: [
    "Exhibit 4: bodycam footage",
    "The light was red.",
    "The light was red.",
    "Q. And then the driver",
  ],
  3: ["accelerated through the intersection?", "A. Yes."],
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
  endPageNumber: null,
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

/** Select from the start of one span to the end of another (default:
 *  the same span) and announce it like a browser would. */
function selectSpan(text: string, nth = 0, endText?: string) {
  const span = screen.getAllByText(text)[nth];
  const end = endText ? screen.getByText(endText) : span;
  const range = document.createRange();
  range.setStart(span.firstChild!, 0);
  range.setEnd(end.firstChild!, end.textContent!.length);
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
      }),
    );
  });

  test("a selection across a page break becomes a page span + quote", async () => {
    render(<PdfReview {...BASE} moments={[]} />);
    selectSpan("Q. And then the driver", 0, "accelerated through the intersection?");
    fireEvent.click(screen.getByRole("button", { name: "Flag selection" }));
    await waitFor(() => expect(lastAnchor?.kind).toBe("page"));
    expect(lastAnchor).toMatchObject({ pageNumber: 2, endPageNumber: 3, hint: undefined });
    expect(lastAnchor && "quote" in lastAnchor && lastAnchor.quote).toMatch(/driver\s*accelerated/);
    expect(handle.pageTextLayers).toHaveBeenCalledWith(2, 3);
  });

  test("a passage that repeats on its page carries a heads-up", async () => {
    render(<PdfReview {...BASE} moments={[]} />);
    selectSpan("The light was red.", 1);
    fireEvent.click(screen.getByRole("button", { name: "Flag selection" }));
    await waitFor(() => expect(lastAnchor?.kind).toBe("page"));
    expect(lastAnchor).toMatchObject({ pageNumber: 2, quote: "The light was red." });
    expect(lastAnchor && "hint" in lastAnchor && lastAnchor.hint).toMatch(
      /appears 2 times on page 2/,
    );
    expect(lastAnchor).not.toHaveProperty("endPageNumber");
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
      <PdfReview
        {...BASE}
        moments={[moment({ id: "p", pageNumber: 2, quote: "bodycam footage" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "go p" }));
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(handle.pageTextLayers).toHaveBeenCalledWith(2, 2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a passage flag spanning pages is found across the page break", async () => {
    render(
      <PdfReview
        {...BASE}
        moments={[
          moment({
            id: "x",
            pageNumber: 2,
            endPageNumber: 3,
            quote: "the driver accelerated through",
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "go x" }));
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(handle.pageTextLayers).toHaveBeenCalledWith(2, 3);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a passage that no longer matches lands on the page and says so", async () => {
    render(
      <PdfReview
        {...BASE}
        moments={[moment({ id: "gone", pageNumber: 1, quote: "bodycam footage" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "go gone" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/not found on page 1/i);
    expect(handle.goToPage).toHaveBeenCalledWith(1);
  });

  test("a page-only flag just goes to the page", () => {
    render(<PdfReview {...BASE} moments={[moment({ id: "pg", pageNumber: 1 })]} />);
    fireEvent.click(screen.getByRole("button", { name: "go pg" }));
    expect(handle.goToPage).toHaveBeenCalledWith(1);
    expect(handle.pageTextLayers).not.toHaveBeenCalled();
  });

  test("a ?flag= deep link focuses its passage once the PDF is ready", async () => {
    render(
      <PdfReview
        {...BASE}
        initialPage={2}
        initialEndPage={3}
        initialQuote="driver accelerated"
        moments={[]}
      />,
    );
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(handle.pageTextLayers).toHaveBeenCalledWith(2, 3);
  });
});
