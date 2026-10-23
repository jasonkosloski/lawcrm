import { describe, expect, it } from "vitest";
import { captionFixture, mergedCaptionFixture, renderFixture } from "./converters-fixture";
import { defaultParagraphStyles } from "./paragraph-styles";
import { resolvePageStyle, DEFAULT_DOCUMENT_STYLE } from "./page-style";
import { pageFontFaceCss, resolvedToHtml, resolvedToPageParts } from "./to-html";
import { renderTemplate } from "./render";
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import { DEFAULT_PARAGRAPH_STYLES } from "./page-style";
import type { TemplateDoc } from "./schema";

describe("resolvedToHtml", () => {
  const html = resolvedToHtml(renderFixture());

  it("marks missing values", () => {
    expect(html).toContain("<mark data-missing>");
    expect(html).toContain("not on file");
  });
  it("keeps headings, alignment, tables, lists and marks", () => {
    expect(html).toMatch(/<p style="[^"]*text-align:center[^"]*">Re: /);
    expect(html).toMatch(/<p style="[^"]*text-align:right[^"]*">Dear /);
    expect(html).toContain('<table data-width="full">');
    expect(html).toMatch(/<th><p style="[^"]*">A<\/p><\/th>/);
    expect(html).toMatch(/<td><p style="[^"]*">1<\/p><\/td>/);
    expect(html).toMatch(
      /<ul><li><p style="[^"]*">one<\/p><\/li><li><p style="[^"]*">two<\/p><\/li><\/ul>/,
    );
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
      style: resolvePageStyle(
        kind,
        { ...base, ...over, paragraphStyles: defaultParagraphStyles({ ...base, ...over }) },
        lg,
      ),
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

describe("resolvedToHtml small caps", () => {
  it("wraps small caps in a span the sanitizer keeps", () => {
    const html = resolvedToHtml({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Plaintiff", marks: [{ type: "bold" }, { type: "smallCaps" }] },
          ],
        },
      ],
    });
    expect(html).toBe("<p><strong><span data-small-caps>Plaintiff</span></strong></p>");
  });
});

describe("paragraph styles in HTML", () => {
  const run = (content: unknown[]) =>
    resolvedToHtml(
      renderTemplate({ type: "doc", content } as unknown as TemplateDoc, {
        data: SAMPLE_TEMPLATE_DATA,
        blocks: new Map(),
        styles: DEFAULT_PARAGRAPH_STYLES,
      }).doc,
    );
  const para = (text: string, attrs?: object, marks?: object[]) => ({
    type: "paragraph",
    attrs,
    content: [{ type: "text", text, marks }],
  });

  it("a caption carries zero margins and survives the sanitizer", () => {
    const html = run([para("cap", { style: "caption" })]);
    expect(html).toContain("margin-top:0pt;margin-bottom:0pt");
  });
  it("headings are paragraphs with inline size and weight", () => {
    const html = run([para("H", { style: "heading1" })]);
    expect(html).toMatch(/^<p style="[^"]*font-weight:bold[^"]*">H<\/p>$/);
    expect(html).not.toContain("<h1");
  });
  it("direct settings win: indents, first line, line spacing, page break", () => {
    const html = run([
      para("x", {
        indentLeftIn: 1,
        firstLine: { kind: "hanging", in: 0.5 },
        lineSpacing: { exactPt: 24 },
        pageBreakBefore: true,
      }),
    ]);
    expect(html).toContain("margin-left:1in");
    expect(html).toContain("text-indent:-0.5in");
    expect(html).toContain("line-height:24pt");
    expect(html).toContain("break-before:page");
  });
  it("allCaps and font size marks become spans", () => {
    const html = run([
      para("x", undefined, [{ type: "allCaps" }, { type: "fontSize", attrs: { pt: 9 } }]),
    ]);
    expect(html).toContain("text-transform:uppercase");
    expect(html).toContain("font-size:9pt");
  });
  it("cell paragraphs have no spacing unless set directly", () => {
    const cellDoc = (attrs?: object) => ({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableCell", content: [para("c", attrs)] }],
        },
      ],
    });
    expect(run([cellDoc()])).toContain("margin-bottom:0pt");
    expect(run([cellDoc({ spaceAfterPt: 6 })])).toContain("margin-bottom:6pt");
  });
  it("list item paragraphs take their style's space after, a direct value wins", () => {
    const listDoc = (attrs?: object) => ({
      type: "bulletList",
      content: [{ type: "listItem", content: [para("i", attrs)] }],
    });
    const html = run([listDoc()]);
    expect(html).toMatch(/<li><p style="[^"]*margin-bottom:12pt/);
    expect(run([listDoc({ spaceAfterPt: 3 })])).toMatch(/<li><p style="[^"]*margin-bottom:3pt/);
  });
});
