import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_KEYS, FONTS, fontPublicUrl } from "./fonts";
import { fontFilePath } from "./fonts-server";

// fontkit (devDependency, same version @react-pdf uses); loaded untyped.
const fontkit = createRequire(import.meta.url)("fontkit") as {
  create: (buf: Buffer) => { familyName: string; numGlyphs: number };
};

const STYLES = ["regular", "bold", "italic", "boldItalic"] as const;
const allFiles = FONT_KEYS.flatMap((k) => STYLES.map((s) => FONTS[k].files[s]));

describe("font registry", () => {
  it("has six fonts, 24 distinct files", () => {
    expect(FONT_KEYS).toHaveLength(6);
    expect(new Set(allFiles).size).toBe(24);
  });

  it("only garamond is not metric-compatible", () => {
    const off = FONT_KEYS.filter((k) => !FONTS[k].metricCompatible);
    expect(off).toEqual(["garamond"]);
  });

  it("maps Word names to bundled families", () => {
    expect(FONTS.times.wordName).toBe("Times New Roman");
    expect(FONTS.arial.wordName).toBe("Arial");
    expect(FONTS.courier.wordName).toBe("Courier New");
    expect(FONTS.schoolbook.wordName).toBe("Century Schoolbook");
    expect(FONTS.palatino.wordName).toBe("Book Antiqua");
    expect(FONTS.garamond.wordName).toBe("Garamond");
    expect(FONTS.palatino.label).toBe("Book Antiqua / Palatino");
  });

  it("builds server paths and public URLs", () => {
    expect(fontFilePath("a.ttf")).toBe(
      path.join(process.cwd(), "src/lib/templates/fonts", "a.ttf"),
    );
    expect(fontPublicUrl("a.ttf")).toBe("/fonts/templates/a.ttf");
  });

  it.each(allFiles)("%s exists in both directories", (file) => {
    expect(existsSync(fontFilePath(file))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "public/fonts/templates", file))).toBe(true);
  });

  it.each(allFiles)("%s parses and matches its public copy", (file) => {
    const buf = readFileSync(fontFilePath(file));
    const font = fontkit.create(buf);
    expect(font.numGlyphs).toBeGreaterThan(100);
    const pub = readFileSync(path.join(process.cwd(), "public/fonts/templates", file));
    expect(pub.equals(buf)).toBe(true);
  });

  it("each font family name matches its registry entry", () => {
    const expected: Record<string, RegExp> = {
      times: /^Liberation Serif/,
      arial: /^Liberation Sans/,
      courier: /^Liberation Mono/,
      schoolbook: /^TeX Gyre Schola/,
      palatino: /^TeX Gyre Pagella/,
      garamond: /^EB Garamond/,
    };
    for (const k of FONT_KEYS) {
      for (const s of STYLES) {
        const font = fontkit.create(readFileSync(fontFilePath(FONTS[k].files[s])));
        expect(font.familyName).toMatch(expected[k]);
      }
    }
  });
});
