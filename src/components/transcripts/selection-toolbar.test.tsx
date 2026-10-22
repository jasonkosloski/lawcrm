/**
 * Selection → span (Review Focus 4), and the toolbar's Flag / Copy actions.
 */

import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

import { SelectionToolbar, selectionToSpan } from "./selection-toolbar";

function Doc() {
  return (
    <div data-testid="root">
      <div data-seg="a">
        <p>
          <span data-s="3" data-e="4">the</span> <span data-s="4" data-e="5">officer</span>{" "}
          <span data-s="5" data-e="6">arrived</span>
        </p>
      </div>
      <div data-seg="b">
        <p>
          <span data-s="20" data-e="21">which</span> <span data-s="21" data-e="22">officer</span>{" "}
          <span data-s="22" data-e="23">was</span>
        </p>
      </div>
    </div>
  );
}

function select(fromWord: string, toWord: string) {
  const find = (t: string) =>
    [...document.querySelectorAll("[data-s]")].find((e) => e.textContent === t)!.firstChild!;
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  const a = find(fromWord);
  const b = find(toWord);
  sel.setBaseAndExtent(a, 0, b, b.textContent!.length);
  return sel;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("selectionToSpan", () => {
  test("across two paragraphs: first word's start, last word's end, selected text", () => {
    const { getByTestId } = render(<Doc />);
    const sel = select("officer", "which");
    // officer(arrived) ... which — spans the paragraph break
    const span = selectionToSpan(sel, getByTestId("root"));
    expect(span).toEqual({
      startSeconds: 4,
      endSeconds: 21,
      quote: "officer arrived which",
    });
  });

  test("a collapsed selection is null", () => {
    const { getByTestId } = render(<Doc />);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    expect(selectionToSpan(sel, getByTestId("root"))).toBeNull();
  });

  test("a selection outside the root is null", () => {
    const { getByTestId } = render(
      <>
        <Doc />
        <p data-testid="out">elsewhere</p>
      </>,
    );
    const sel = window.getSelection()!;
    sel.setBaseAndExtent(getByTestId("out").firstChild!, 0, getByTestId("out").firstChild!, 5);
    expect(selectionToSpan(sel, getByTestId("root"))).toBeNull();
  });
});

describe("SelectionToolbar", () => {
  function mount(over: Partial<React.ComponentProps<typeof SelectionToolbar>> = {}) {
    const onFlag = vi.fn();
    function Harness() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <>
          <div ref={ref}>
            <Doc />
          </div>
          <SelectionToolbar
            rootRef={ref}
            documentName="Bodycam.mp4"
            canFlag
            onFlag={onFlag}
            {...over}
          />
        </>
      );
    }
    const utils = render(<Harness />);
    return { onFlag, ...utils };
  }
  const choose = () => {
    select("officer", "which");
    act(() => void document.dispatchEvent(new Event("selectionchange")));
  };

  test("nothing selected shows no toolbar", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Copy with timecode" })).toBeNull();
  });

  test("Flag selection hands the span to onFlag", () => {
    const { onFlag } = mount();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Flag selection" }));
    expect(onFlag).toHaveBeenCalledWith({
      startSeconds: 4,
      endSeconds: 21,
      quote: "officer arrived which",
    });
  });

  test("Flag selection is hidden without permission", () => {
    mount({ canFlag: false });
    choose();
    expect(screen.queryByRole("button", { name: "Flag selection" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy with timecode" })).toBeTruthy();
  });

  test("Copy with timecode writes the exact string to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Copy with timecode" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '"officer arrived which" (Bodycam.mp4 at 0:04)',
      ),
    );
  });
});
