import { Mark, mergeAttributes } from "@tiptap/core";

/** All caps text format (Word: Ctrl+Shift+A). */
export const AllCaps = Mark.create({
  name: "allCaps",
  parseHTML: () => [
    { tag: "span[data-all-caps]" },
    {
      style: "text-transform",
      getAttrs: (value) => (String(value).includes("uppercase") ? null : false),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-all-caps": "", style: "text-transform:uppercase" }),
    0,
  ],
  addCommands() {
    return {
      toggleAllCaps:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-a": () => this.editor.commands.toggleAllCaps() };
  },
});

/** A run's own size in points (beats the paragraph style's size). */
export const FontSize = Mark.create({
  name: "fontSize",
  addAttributes() {
    return {
      pt: {
        default: 12,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-font-size")),
        renderHTML: (a: { pt?: number }) =>
          a.pt ? { "data-font-size": String(a.pt), style: `font-size:${String(a.pt)}pt` } : {},
      },
    };
  },
  parseHTML: () => [
    {
      tag: "span[data-font-size]",
      getAttrs: (el) => (Number(el.getAttribute("data-font-size")) > 0 ? null : false),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
  addCommands() {
    return {
      setFontSize:
        (pt) =>
        ({ commands }) =>
          pt === null ? commands.unsetMark(this.name) : commands.setMark(this.name, { pt }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    allCaps: {
      toggleAllCaps: () => ReturnType;
    };
    fontSize: {
      /** A size in points; null removes the size mark. */
      setFontSize: (pt: number | null) => ReturnType;
    };
  }
}
