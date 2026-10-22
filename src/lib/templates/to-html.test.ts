import { describe, expect, it } from "vitest";
import { resolvedToHtml } from "./to-html";
import { captionFixture, mergedCaptionFixture, renderFixture } from "./converters-fixture";

describe("resolvedToHtml", () => {
  const html = resolvedToHtml(renderFixture());

  it("marks missing values", () => {
    expect(html).toContain("<mark data-missing>");
    expect(html).toContain("not on file");
  });
  it("keeps headings, alignment, tables, lists and marks", () => {
    expect(html).toContain('<h2 style="text-align:center">');
    expect(html).toContain('<p style="text-align:right">');
    expect(html).toContain('<table data-width="full">');
    expect(html).toContain("<th><p>A</p></th>");
    expect(html).toContain("<td><p>1</p></td>");
    expect(html).toContain("<ul><li><p>one</p></li><li><p>two</p></li></ul>");
    expect(html).toContain("<ol><li>");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em><u>End</u></em>");
    expect(html).toContain("<br />");
    expect(html).toContain("<hr data-page-break");
  });
  it("escapes text so no script or tag survives", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>Notice");
    expect(html).toContain("&lt;b&gt;Notice&lt;/b&gt;");
  });
});

import { resolvePageStyle, DEFAULT_DOCUMENT_STYLE } from "./page-style";
import { resolvedToPageParts, pageFontFaceCss } from "./to-html";

describe("resolvedToPageParts", () => {
  const doc = renderFixture();
  const base = { ...DEFAULT_DOCUMENT_STYLE, letterheadBlockId: "b1", continuationBlockId: "b2" };
  const logo = {
    bytes: new Uint8Array(),
    contentType: "image/png" as const,
    position: "right" as const,
  };
  const mk = (kind: "letter" | "filing", over = {}, lg: typeof logo | null = null) =>
    resolvedToPageParts({
      body: doc,
      letterhead: doc,
      continuation: doc,
      style: resolvePageStyle(kind, { ...base, ...over }, lg),
      logoUrl: "/api/document-style/logo",
    });

  it("reflects style values in vars and padding", () => {
    const p = mk("letter", {
      fontSizeHalfPt: 26,
      spaceAfterPt: 6,
      marginLeftIn: 1.5,
      lineSpacing: "1.5",
    });
    expect(p.style["--page-font-size"]).toBe(`${13 * (96 / 72)}px`);
    expect(p.style["--page-space-after"]).toBe("8px");
    expect(p.style.paddingLeft).toBe("144px");
    expect(p.style["--page-line-height"]).toBe(String(1.5 * 1.15));
    expect(p.fontFamily).toContain("Tpl Liberation Serif");
  });

  it("letters follow Word's header rule; filings pad by the top margin", () => {
    const letter = mk("letter", { marginTopIn: 1.5 });
    // Header distance 35.4 pt = 47.2 px; header area fills to the 1.5 in margin.
    expect(parseFloat(letter.style.paddingTop)).toBeCloseTo(47.2, 5);
    expect(letter.headerMinHeightPx).toBeCloseTo(144 - 47.2, 5);
    const filing = mk("filing", { marginTopIn: 1.5 });
    expect(filing.style.paddingTop).toBe("144px");
    expect(filing.headerMinHeightPx).toBeNull();
  });
  it("letter: letterhead, logo, top strip with right Page 2", () => {
    const p = mk("letter", {}, logo);
    expect(p.letterheadHtml).toContain("<table data-width");
    expect(p.logo).toEqual({ url: "/api/document-style/logo", position: "right" });
    expect(p.strip?.placement).toBe("top");
    expect(p.strip?.continuationHtml).toContain("<table data-width");
    expect(p.strip?.pageLabel).toEqual({ text: "Page 2", align: "right" });
  });
  it("letter without page numbers keeps continuation only; nothing -> no strip", () => {
    expect(mk("letter", { pageNumbers: "none" }).strip?.pageLabel).toBeNull();
    const none = resolvedToPageParts({
      body: doc,
      letterhead: null,
      continuation: null,
      style: resolvePageStyle("letter", { ...DEFAULT_DOCUMENT_STYLE, pageNumbers: "none" }, null),
      logoUrl: null,
    });
    expect(none.strip).toBeNull();
    expect(none.letterheadHtml).toBeNull();
    expect(none.logo).toBeNull();
  });
  it("filing: no letterhead/logo/continuation; bottom Page 2 or no strip", () => {
    const p = mk("filing", { pageNumbers: "bottom_right" }, logo);
    expect(p.letterheadHtml).toBeNull();
    expect(p.logo).toBeNull();
    expect(p.strip).toEqual({
      placement: "bottom",
      continuationHtml: null,
      pageLabel: { text: "Page 2", align: "right" },
    });
    expect(mk("filing", { pageNumbers: "bottom_center" }).strip?.pageLabel?.align).toBe("center");
    expect(mk("filing", { pageNumbers: "none" }).strip).toBeNull();
  });
  it("min height follows the paper size, 96 px per inch", () => {
    expect(mk("filing", {}).minHeightPx).toBe(11 * 96);
    const legal = resolvedToPageParts({
      body: doc,
      letterhead: null,
      continuation: null,
      style: {
        ...resolvePageStyle("filing", DEFAULT_DOCUMENT_STYLE, null),
        paperSize: "legal",
      },
      logoUrl: null,
    });
    expect(legal.minHeightPx).toBe(14 * 96);
  });
  it("emits one font-face per face with the prefixed family", () => {
    const css = pageFontFaceCss("times");
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css).toContain('"Tpl Liberation Serif"');
    expect(css).toContain("/fonts/templates/LiberationSerif-BoldItalic.ttf");
    expect(css).toContain("font-display:swap");
  });
  it("sanitized fragments carry no raw page style", () => {
    expect(mk("letter").bodyHtml).not.toContain("--page");
  });
});

describe("resolvedToHtml tables", () => {
  const html = resolvedToHtml(captionFixture());

  it("keeps column proportions, merges, borders and vertical alignment through the sanitizer", () => {
    expect(html).toContain(
      '<table data-width="full"><colgroup><col style="width:66.67%" /><col style="width:33.33%" /></colgroup>',
    );
    expect(html).toContain('<td data-bb="none"><p></p></td>');
    expect(html).toContain('<td data-bt="none" data-bb="thick" data-valign="bottom">');
    expect(html).toContain('<td colspan="2"><p style="text-align:center"><strong>MOTION');
    // Sides go out as declared; collapsed CSS draws the heavier per segment.
    expect(html).toContain('<td data-bt="thick" data-bb="thick"><p><strong>Plaintiff');
    expect(html).toContain("<td><p>Attorney: Pat Lawyer</p></td>");
  });

  it("keeps paragraph alignment inside cells", () => {
    expect(html).toContain('<p style="text-align:center"><strong>▲ COURT USE ONLY ▲</strong></p>');
  });

  it("emits set pixel widths for a fit table", () => {
    const doc = captionFixture();
    const t = doc.content![0];
    if (t.type === "table") {
      t.attrs = { width: "fit" };
      t.content[0].content[1].attrs = { colwidth: [200.333] };
    }
    const out = resolvedToHtml(doc);
    // Rounded, so the sanitizer's numeric width rule keeps it.
    expect(out).toContain(
      '<colgroup><col style="width:400px" /><col style="width:200px" /></colgroup>',
    );
  });
});

describe("resolvedToHtml row spans", () => {
  it("writes rowspan on a cell merged down", () => {
    const html = resolvedToHtml(mergedCaptionFixture());
    expect(html).toContain('<td rowspan="2" data-bb="thick" data-valign="bottom">');
    // The second row holds only the left cell.
    expect(html).toContain('<tr><td data-bt="thick" data-bb="thick"><p><strong>Plaintiff');
  });
});
