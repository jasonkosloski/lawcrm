/**
 * Tests for the search-snippet renderer.
 *
 * The marker protocol (control chars \u0001 / \u0002 around the
 * matched range) is produced by makeSnippet in
 * src/lib/queries/search.ts; this file pins the render side: marked
 * ranges become <mark>, everything else renders verbatim, and
 * malformed input degrades to plain text instead of dropping it.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  SearchSnippet,
  SNIPPET_MARK_END,
  SNIPPET_MARK_START,
} from "./snippet";

const mark = (s: string) => `${SNIPPET_MARK_START}${s}${SNIPPET_MARK_END}`;

describe("SearchSnippet", () => {
  test("wraps the marked range in <mark> and keeps surrounding text", () => {
    const { container } = render(
      <SearchSnippet snippet={`…called about the ${mark("ambulance")} report…`} />
    );
    const marked = container.querySelector("mark");
    expect(marked).not.toBeNull();
    expect(marked!.textContent).toBe("ambulance");
    expect(container.textContent).toBe(
      "…called about the ambulance report…"
    );
  });

  test("renders multiple highlighted ranges", () => {
    const { container } = render(
      <SearchSnippet snippet={`${mark("fee")} petition and ${mark("fee")} award`} />
    );
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
  });

  test("plain snippet without markers renders as-is with no <mark>", () => {
    const { container } = render(<SearchSnippet snippet="no match context" />);
    expect(container.querySelector("mark")).toBeNull();
    expect(screen.getByText("no match context")).toBeInTheDocument();
  });

  test("unbalanced start marker degrades to plain text (nothing dropped)", () => {
    const { container } = render(
      <SearchSnippet snippet={`before ${SNIPPET_MARK_START}dangling tail`} />
    );
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("before dangling tail");
  });

  test("snippet text is escaped, not parsed as HTML", () => {
    const { container } = render(
      <SearchSnippet snippet={`<img src=x onerror=alert(1)> ${mark("x")}`} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
