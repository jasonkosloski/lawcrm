/**
 * EmbeddedInbox layout: a fixed 352px list beside a flex reader left
 * the reader zero width on a phone. Below lg it must drill down (list
 * until a thread is selected, then the reader); at lg+ both panes show.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./embedded-thread-list", () => ({
  EmbeddedThreadList: () => <div data-testid="list" />,
}));
vi.mock("./thread-reader", () => ({
  ThreadReader: () => <div data-testid="reader" />,
}));

import type { ThreadDetail, ThreadListRow } from "@/lib/queries/communication";
import { EmbeddedInbox } from "./embedded-inbox";

// `overflow-hidden` on the reader is unrelated to the display toggle.
const HIDDEN = /(^|\s)hidden(\s|$)/;

const threads = [{ id: "t1" }] as unknown as ThreadListRow[];
const selected = { id: "t1" } as unknown as ThreadDetail;

function panes(selectedThread: ThreadDetail | null) {
  render(
    <EmbeddedInbox
      threads={threads}
      selectedThread={selectedThread}
      filingOptions={[]}
      leadOptions={[]}
      basePath="/matters/m1/communication"
      emptyLabel="Nothing"
    />,
  );
  return {
    list: screen.getByTestId("list").parentElement!,
    reader: screen.getByTestId("reader").parentElement!,
  };
}

describe("EmbeddedInbox responsive drill-down", () => {
  test("no thread selected: list fills the width on phones, reader hidden below lg", () => {
    const { list, reader } = panes(null);
    expect(list.className).toContain("flex w-full");
    expect(list.className).not.toMatch(HIDDEN);
    expect(list.className).toContain("lg:w-88");
    expect(reader.className).toContain("hidden lg:flex");
  });

  test("thread selected: reader takes over below lg, list hidden until lg", () => {
    const { list, reader } = panes(selected);
    expect(list.className).toContain("hidden lg:flex");
    expect(list.className).toContain("lg:w-88");
    expect(reader.className).toMatch(/(^|\s)flex(\s|$)/);
    expect(reader.className).not.toMatch(HIDDEN);
  });

  test("the fixed list width only applies at lg+", () => {
    const { list } = panes(null);
    // A bare `w-88` would pin the list to 352px on a phone.
    expect(list.className).not.toMatch(/(^|\s)w-88(\s|$)/);
  });
});
