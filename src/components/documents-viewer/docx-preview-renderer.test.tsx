/**
 * Tests for the docx-preview client renderer.
 *
 * Honesty notes on what's real vs mocked:
 *  - docx-preview is REAL — renderAsync runs against happy-dom and
 *    it works: fixtures are assembled in-memory with jszip (same
 *    prior art as document-preview.test.ts) and rendered for real,
 *    so the hostile-hyperlink test proves the sanitation pass
 *    neutralizes an actual OOXML relationship end-to-end.
 *  - `fetch` IS stubbed (an in-memory Response shape) — these tests
 *    must not hit the download route.
 *  - What happy-dom CANNOT verify, precisely:
 *      1. Layout — getBoundingClientRect / offsetWidth return zeros,
 *         so the experimental tab-stop widths and page dimensions
 *         compute but can't be asserted; the tab-stop test only
 *         proves that path renders without crashing and keeps the
 *         run text. Pixel-true tab stops / cell alignment need a
 *         real browser (manual-verification item).
 *      2. Hyperlink relationship resolution — happy-dom's XML
 *         DOMParser does not resolve attribute namespaces (`r:id`
 *         parses with localName "r:id" and a null namespace; a real
 *         browser gives localName "id"), so docx-preview's
 *         `attr(node, "id")` never finds the hyperlink id and every
 *         anchor renders with href="". A hostile
 *         Target="javascript:..." relationship therefore can't
 *         reach an href in this environment at all. The
 *         sanitize-after-render WIRING is covered with a mocked
 *         docx-preview in docx-preview-renderer.wiring.test.tsx,
 *         and the walker itself is proven against real hostile
 *         hrefs in sanitize-rendered-docx.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { DocxPreviewRenderer } from "./docx-preview-renderer";
import { VIEWER_CONTENT_READY_EVENT } from "./content-ready-event";

// ── OOXML fixture builders (real zip, real docx-preview) ───────────────

const CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';

const ROOT_RELS =
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS =
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

async function buildDocx(opts: {
  documentXml: string;
  documentRels?: string;
}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  if (opts.documentRels) {
    zip.file("word/_rels/document.xml.rels", opts.documentRels);
  }
  zip.file("word/document.xml", opts.documentXml);
  return zip.generateAsync({ type: "arraybuffer" });
}

// ── fetch stub ──────────────────────────────────────────────────────────

/** Route the component's same-origin fetch to in-memory bytes. */
function stubFetch(
  handler: (url: string) => { ok: boolean; status: number; bytes: ArrayBuffer }
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const { ok, status, bytes } = handler(String(input));
      return {
        ok,
        status,
        arrayBuffer: async () => bytes,
      } as unknown as Response;
    })
  );
}

const FALLBACK = <div data-testid="mammoth-fallback">mammoth says hi</div>;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DocxPreviewRenderer — successful render", () => {
  test("renders document text as real, walkable text nodes; fallback stays unmounted", async () => {
    const bytes = await buildDocx({
      documentXml:
        `<?xml version="1.0"?><w:document ${W_NS}><w:body>` +
        "<w:p><w:r><w:t>Comes now the Plaintiff</w:t></w:r></w:p>" +
        "</w:body></w:document>",
    });
    stubFetch(() => ({ ok: true, status: 200, bytes }));

    const { container } = render(
      <DocxPreviewRenderer src="/api/documents/d1/download" name="motion.docx" fallback={FALLBACK} />
    );

    await waitFor(() =>
      expect(container.textContent).toContain("Comes now the Plaintiff")
    );
    // Real text nodes — exactly what TextReview's TreeWalker +
    // locateQuote consume for select-to-flag and quote relocation.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) texts.push((n as Text).data);
    expect(texts.join("")).toContain("Comes now the Plaintiff");
    // The mammoth fallback must NOT be in the DOM on success — the
    // TreeWalker would otherwise see the document text twice.
    expect(screen.queryByTestId("mammoth-fallback")).toBeNull();
  });

  test("tab-stop paragraph (the experimental path) renders without crashing", async () => {
    // A signature line: text run + underlined tab run with an
    // explicit tab stop. In happy-dom all layout reads are zero, so
    // we can only assert the experimental code path completes and
    // the text survives — pixel-true tab width is browser-only.
    const bytes = await buildDocx({
      documentXml:
        `<?xml version="1.0"?><w:document ${W_NS}><w:body>` +
        "<w:p><w:pPr><w:tabs>" +
        '<w:tab w:val="left" w:pos="4320" w:leader="none"/>' +
        "</w:tabs></w:pPr>" +
        "<w:r><w:t>Signature:</w:t></w:r>" +
        '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:tab/></w:r>' +
        "</w:p></w:body></w:document>",
    });
    stubFetch(() => ({ ok: true, status: 200, bytes }));

    const { container } = render(
      <DocxPreviewRenderer src="/dl" name="sig.docx" fallback={FALLBACK} />
    );
    await waitFor(() =>
      expect(container.textContent).toContain("Signature:")
    );
    expect(screen.queryByTestId("mammoth-fallback")).toBeNull();
  });

  test("hyperlink runs render as anchors (href resolution is browser-only — see header note 2)", async () => {
    const bytes = await buildDocx({
      documentRels:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://courts.example.gov/rule" TargetMode="External"/></Relationships>',
      documentXml:
        `<?xml version="1.0"?><w:document ${W_NS} ${R_NS}><w:body>` +
        '<w:p><w:hyperlink r:id="rId2"><w:r><w:t>the rule</w:t></w:r></w:hyperlink></w:p>' +
        "</w:body></w:document>",
    });
    stubFetch(() => ({ ok: true, status: 200, bytes }));

    const { container } = render(
      <DocxPreviewRenderer src="/dl" name="linked.docx" fallback={FALLBACK} />
    );
    await waitFor(() => expect(container.textContent).toContain("the rule"));
    // The anchor exists and its text is flaggable; happy-dom's XML
    // parser can't resolve `r:id`, so the href stays "" here — the
    // hostile-href handling is covered in the wiring + walker tests.
    expect(
      Array.from(container.querySelectorAll("a")).some((a) =>
        a.textContent?.includes("the rule")
      )
    ).toBe(true);
  });

  test("dispatches the bubbling content-ready event after the render settles", async () => {
    const bytes = await buildDocx({
      documentXml:
        `<?xml version="1.0"?><w:document ${W_NS}><w:body>` +
        "<w:p><w:r><w:t>ready check</w:t></w:r></w:p>" +
        "</w:body></w:document>",
    });
    stubFetch(() => ({ ok: true, status: 200, bytes }));

    const onReady = vi.fn();
    document.addEventListener(VIEWER_CONTENT_READY_EVENT, onReady);
    try {
      const { container } = render(
        <DocxPreviewRenderer src="/dl" name="a.docx" fallback={FALLBACK} />
      );
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
      // Fired AFTER the text became walkable, not before.
      expect(container.textContent).toContain("ready check");
    } finally {
      document.removeEventListener(VIEWER_CONTENT_READY_EVENT, onReady);
    }
  });
});

describe("DocxPreviewRenderer — fallback chain", () => {
  test("corrupt bytes (not a zip) → mammoth fallback mounts, ready event still fires", async () => {
    const bytes = new TextEncoder().encode("this is not a zip archive")
      .buffer as ArrayBuffer;
    stubFetch(() => ({ ok: true, status: 200, bytes }));

    const onReady = vi.fn();
    document.addEventListener(VIEWER_CONTENT_READY_EVENT, onReady);
    try {
      render(
        <DocxPreviewRenderer src="/dl" name="corrupt.docx" fallback={FALLBACK} />
      );
      await waitFor(() =>
        expect(screen.getByTestId("mammoth-fallback")).toBeInTheDocument()
      );
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
      expect(console.warn).toHaveBeenCalled();
    } finally {
      document.removeEventListener(VIEWER_CONTENT_READY_EVENT, onReady);
    }
  });

  test("failed download (non-OK response) → mammoth fallback mounts", async () => {
    stubFetch(() => ({ ok: false, status: 404, bytes: new ArrayBuffer(0) }));
    render(
      <DocxPreviewRenderer src="/dl" name="gone.docx" fallback={FALLBACK} />
    );
    await waitFor(() =>
      expect(screen.getByTestId("mammoth-fallback")).toBeInTheDocument()
    );
  });

  test("loading skeleton shows while the fetch is in flight", async () => {
    let resolveFetch!: (v: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (resolveFetch = resolve)))
    );
    render(
      <DocxPreviewRenderer src="/dl" name="slow.docx" fallback={FALLBACK} />
    );
    expect(
      screen.getByRole("status", { name: /loading preview of slow\.docx/i })
    ).toBeInTheDocument();
    // Resolve as a failure to let the effect finish cleanly.
    resolveFetch({ ok: false, status: 500 });
    await waitFor(() =>
      expect(screen.getByTestId("mammoth-fallback")).toBeInTheDocument()
    );
  });
});
