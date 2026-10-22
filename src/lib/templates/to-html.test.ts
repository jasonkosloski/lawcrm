import { describe, expect, it } from "vitest";
import { resolvedToHtml } from "./to-html";
import { renderFixture } from "./converters-fixture";

describe("resolvedToHtml", () => {
  const html = resolvedToHtml(renderFixture());

  it("marks missing values", () => {
    expect(html).toContain("<mark data-missing>");
    expect(html).toContain("not on file");
  });
  it("keeps headings, alignment, tables, lists and marks", () => {
    expect(html).toContain('<h2 style="text-align:center">');
    expect(html).toContain('<p style="text-align:right">');
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
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
