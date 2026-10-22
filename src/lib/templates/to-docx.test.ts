import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { resolvedToDocx } from "./to-docx";
import { renderFixture } from "./converters-fixture";

describe("resolvedToDocx", () => {
  it("writes a docx with text, a page break, a table, lists and highlight", async () => {
    const buf = await resolvedToDocx(renderFixture());
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Dear ");
    expect(xml).toContain("<script>alert(1)</script>".replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("not on file");
  });
});
