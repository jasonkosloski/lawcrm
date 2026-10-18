/**
 * DocumentFileTree — the viewer's left-hand folders + files rail.
 * Pins: the current document is visible (its folder chain open) and
 * marked aria-current; folders toggle; the filter narrows by file or
 * folder name; the rail collapses and remembers it; and over the load
 * cap, other folders link to the Documents tab instead of listing.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ ref, ...props }: React.ComponentProps<"a">) => <a ref={ref} {...props} />,
}));

import { DocumentFileTree } from "./document-file-tree";
import type { FolderNode } from "@/lib/folder-tree";

const TREE: FolderNode[] = [
  {
    id: "disc",
    name: "Discovery",
    parentId: null,
    children: [{ id: "body", name: "Bodycam", parentId: "disc", children: [] }],
  },
  { id: "med", name: "Medical", parentId: null, children: [] },
];

const DOCS = [
  { id: "d1", name: "Retainer.pdf", folderId: null, contentType: "application/pdf" },
  { id: "d2", name: "Police report.pdf", folderId: "disc", contentType: "application/pdf" },
  { id: "d3", name: "cam-01.mp4", folderId: "body", contentType: "video/mp4" },
  { id: "d4", name: "ER records.pdf", folderId: "med", contentType: "application/pdf" },
];

function renderTree(over: Partial<React.ComponentProps<typeof DocumentFileTree>> = {}) {
  return render(
    <DocumentFileTree
      matterId="m1"
      tree={TREE}
      documents={DOCS}
      complete
      currentId="d3"
      currentFolderId="body"
      {...over}
    />
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
});
afterEach(() => window.localStorage.clear());

describe("DocumentFileTree", () => {
  test("the current document shows inside its opened folders, marked current", () => {
    renderTree();
    const current = screen.getByRole("link", { name: /cam-01\.mp4/ });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("href", "/matters/m1/documents/d3");
    expect(screen.getByRole("button", { name: /Discovery/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Bodycam/ })).toHaveAttribute("aria-expanded", "true");
    // Unrelated folders start closed; root files are listed.
    expect(screen.getByRole("button", { name: /Medical/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("ER records.pdf")).toBeNull();
    expect(screen.getByRole("link", { name: /Retainer\.pdf/ })).toBeInTheDocument();
  });

  test("folders open and close", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: /Medical/ }));
    expect(screen.getByRole("link", { name: /ER records\.pdf/ })).toHaveAttribute("href", "/matters/m1/documents/d4");
    fireEvent.click(screen.getByRole("button", { name: /Medical/ }));
    expect(screen.queryByText("ER records.pdf")).toBeNull();
  });

  test("the filter narrows to matching files (opening their folders)", () => {
    renderTree();
    fireEvent.change(screen.getByLabelText("Filter files"), { target: { value: "er rec" } });
    expect(screen.getByRole("link", { name: /ER records\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByText("Retainer.pdf")).toBeNull();
    expect(screen.queryByText("cam-01.mp4")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter files"), { target: { value: "zzz" } });
    expect(screen.getByText(/No files match/)).toBeInTheDocument();
  });

  test("collapses to a strip and remembers it", () => {
    const { unmount } = renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Hide files" }));
    expect(screen.queryByLabelText("Filter files")).toBeNull();
    unmount();
    renderTree();
    expect(screen.getByRole("button", { name: "Show files" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show files" }));
    expect(screen.getByLabelText("Filter files")).toBeInTheDocument();
  });

  test("over the load cap, other folders link to the Documents tab", () => {
    renderTree({ complete: false, documents: DOCS.filter((d) => d.folderId === "body") });
    // The current folder still lists its files.
    expect(screen.getByRole("link", { name: /cam-01\.mp4/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Medical/ }));
    const medical = screen.getByRole("button", { name: /Medical/ }).closest("li")!;
    expect(within(medical).getByRole("link", { name: /Open folder in Documents/ })).toHaveAttribute(
      "href",
      "/matters/m1/documents?folder=med"
    );
    expect(screen.getByText(/too many files to list here/)).toBeInTheDocument();
  });
});
