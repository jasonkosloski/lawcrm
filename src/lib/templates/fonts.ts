import path from "node:path";

/**
 * Font registry for generated letters. The .docx names `wordName` (the
 * recipient's Word supplies it); the PDF embeds the bundled `pdfFamily`
 * files, which have identical metrics for every key but `garamond`, so
 * both formats break lines the same way. Files live in
 * `src/lib/templates/fonts/` (shipped via outputFileTracingIncludes) and
 * are copied to `public/fonts/templates/` for browser previews.
 */
export type FontKey = "times" | "arial" | "garamond" | "schoolbook" | "palatino" | "courier";

export const FONT_KEYS: readonly FontKey[] = [
  "times",
  "arial",
  "garamond",
  "schoolbook",
  "palatino",
  "courier",
];

export type FontFiles = { regular: string; bold: string; italic: string; boldItalic: string };

export type FontDef = {
  label: string;
  wordName: string;
  pdfFamily: string;
  files: FontFiles;
  metricCompatible: boolean;
};

const ttfStyles = (family: string): FontFiles => ({
  regular: `${family}-Regular.ttf`,
  bold: `${family}-Bold.ttf`,
  italic: `${family}-Italic.ttf`,
  boldItalic: `${family}-BoldItalic.ttf`,
});

const texGyre = (family: string): FontFiles => ({
  regular: `${family}-regular.otf`,
  bold: `${family}-bold.otf`,
  italic: `${family}-italic.otf`,
  boldItalic: `${family}-bolditalic.otf`,
});

export const FONTS: Record<FontKey, FontDef> = {
  times: {
    label: "Times New Roman",
    wordName: "Times New Roman",
    pdfFamily: "Liberation Serif",
    files: ttfStyles("LiberationSerif"),
    metricCompatible: true,
  },
  arial: {
    label: "Arial",
    wordName: "Arial",
    pdfFamily: "Liberation Sans",
    files: ttfStyles("LiberationSans"),
    metricCompatible: true,
  },
  garamond: {
    label: "Garamond",
    wordName: "Garamond",
    pdfFamily: "EB Garamond",
    files: ttfStyles("EBGaramond"),
    metricCompatible: false,
  },
  schoolbook: {
    label: "Century Schoolbook",
    wordName: "Century Schoolbook",
    pdfFamily: "TeX Gyre Schola",
    files: texGyre("texgyreschola"),
    metricCompatible: true,
  },
  palatino: {
    label: "Book Antiqua / Palatino",
    wordName: "Book Antiqua",
    pdfFamily: "TeX Gyre Pagella",
    files: texGyre("texgyrepagella"),
    metricCompatible: true,
  },
  courier: {
    label: "Courier New",
    wordName: "Courier New",
    pdfFamily: "Liberation Mono",
    files: ttfStyles("LiberationMono"),
    metricCompatible: true,
  },
};

/** Absolute path of a bundled font file (server only). */
export function fontFilePath(file: string): string {
  return path.join(process.cwd(), "src/lib/templates/fonts", file);
}

/** Browser URL of a font file, for `@font-face` in previews. */
export function fontPublicUrl(file: string): string {
  return `/fonts/templates/${file}`;
}
