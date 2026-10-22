/**
 * PdfDocumentViewer — switching from one PDF straight to another.
 *
 * pdf.js shares one worker across documents and refuses to start a
 * load while that worker is still being destroyed ("PDFWorker.create
 * - the worker is being destroyed"). The viewer used to fire the next
 * load without waiting for the last destroy, so opening a second PDF
 * from the file tree showed "This PDF couldn't be displayed". The fake
 * pdf.js below enforces the same rule.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const calls: string[] = [];
let destroying = false;

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerPort: {} },
  TextLayer: class {},
  getDocument: ({ url }: { url: string }) => {
    if (destroying) throw new Error("PDFWorker.create - the worker is being destroyed.");
    calls.push(url);
    return {
      // Never resolves: the test is about the load starting cleanly.
      promise: new Promise(() => {}),
      destroy: () => {
        destroying = true;
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            destroying = false;
            resolve();
          }, 20),
        );
      },
    };
  },
}));

import { PdfDocumentViewer } from "./pdf-document-viewer";

describe("PdfDocumentViewer — switching documents", () => {
  test("the next PDF waits for the previous one's teardown instead of failing", async () => {
    const { rerender } = render(<PdfDocumentViewer key="a" src="/a.pdf" name="a.pdf" />);
    await waitFor(() => expect(calls).toEqual(["/a.pdf"]));

    // What the page does on a file-tree click: a fresh viewer for b.
    rerender(<PdfDocumentViewer key="b" src="/b.pdf" name="b.pdf" />);
    await waitFor(() => expect(calls).toEqual(["/a.pdf", "/b.pdf"]));
    expect(screen.queryByText(/couldn't be displayed/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading PDF…");
  });
});
