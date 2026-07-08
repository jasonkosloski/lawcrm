/**
 * Sanitation WIRING test for the docx-preview renderer — docx-preview
 * is MOCKED here, on purpose.
 *
 * The real-render tests (docx-preview-renderer.test.tsx) can't push a
 * hostile hyperlink all the way to an href because happy-dom's XML
 * parser doesn't resolve the `r:id` attribute namespace (see the
 * honesty notes there). This file closes that gap at the component
 * seam instead: a mock renderAsync writes exactly the dangerous DOM a
 * compromised/updated library COULD emit into the container, and we
 * assert the component sanitizes it after renderAsync resolves and
 * before revealing the render. Combined with the pure walker tests
 * (sanitize-rendered-docx.test.ts, real hostile hrefs) this proves
 * both halves of the chain; only the happy-dom-impossible middle
 * (docx-preview's own OOXML→href fidelity) is left to the browser.
 *
 * Separate file because vi.mock is module-wide — the sibling test
 * file needs the real docx-preview.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { DocxPreviewRenderer } from "./docx-preview-renderer";

const renderAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("docx-preview", () => ({ renderAsync: renderAsyncMock }));

const FALLBACK = <div data-testid="mammoth-fallback">fallback</div>;

afterEach(() => {
  vi.unstubAllGlobals();
  renderAsyncMock.mockReset();
});

function stubFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
  );
}

describe("DocxPreviewRenderer — sanitation runs on whatever renderAsync emits", () => {
  test("hostile anchors, active elements, and remote images are neutralized post-render", async () => {
    stubFetchOk();
    renderAsyncMock.mockImplementation(async (_bytes, container: HTMLElement) => {
      container.innerHTML =
        '<div class="docx-wrapper"><section class="docx">' +
        '<p><a href="javascript:alert(1)">bad link</a></p>' +
        '<p><a href="https://example.com/x">good link</a></p>' +
        "<script>alert(2)</script>" +
        '<iframe srcdoc="<script>alert(3)</script>"></iframe>' +
        '<img src="https://evil.example/pixel.gif">' +
        "</section></div>";
    });

    const { container } = render(
      <DocxPreviewRenderer src="/dl" name="wired.docx" fallback={FALLBACK} />
    );
    await waitFor(() => expect(container.textContent).toContain("bad link"));

    const anchors = Array.from(container.querySelectorAll("a"));
    const bad = anchors.find((a) => a.textContent === "bad link")!;
    expect(bad.hasAttribute("href")).toBe(false);
    const good = anchors.find((a) => a.textContent === "good link")!;
    expect(good.getAttribute("target")).toBe("_blank");
    expect(good.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector("script, iframe")).toBeNull();
    expect(container.querySelector("img")!.hasAttribute("src")).toBe(false);
  });

  test("renderAsync receives the security-critical options", async () => {
    stubFetchOk();
    renderAsyncMock.mockImplementation(async (_b, container: HTMLElement) => {
      container.textContent = "ok";
    });
    const { container } = render(
      <DocxPreviewRenderer src="/dl" name="opts.docx" fallback={FALLBACK} />
    );
    await waitFor(() => expect(container.textContent).toContain("ok"));
    const options = renderAsyncMock.mock.calls[0][3];
    // altChunks are raw embedded HTML in an iframe srcdoc — MUST stay
    // off for untrusted discovery files.
    expect(options.renderAltChunks).toBe(false);
    // experimental is the tab-stop engine — the original user bug.
    expect(options.experimental).toBe(true);
    // Real page dimensions.
    expect(options.ignoreWidth).toBe(false);
    expect(options.ignoreHeight).toBe(false);
  });

  test("renderAsync rejecting clears the partial render and mounts the fallback", async () => {
    stubFetchOk();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderAsyncMock.mockImplementation(async (_b, container: HTMLElement) => {
      container.innerHTML = "<p>half a document</p>";
      throw new Error("unsupported structure");
    });
    const { container, getByTestId } = render(
      <DocxPreviewRenderer src="/dl" name="boom.docx" fallback={FALLBACK} />
    );
    await waitFor(() =>
      expect(getByTestId("mammoth-fallback")).toBeInTheDocument()
    );
    // No stale docx-preview text for TextReview's TreeWalker to find.
    expect(container.textContent).not.toContain("half a document");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
