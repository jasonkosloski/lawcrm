import { Mark, mergeAttributes } from "@tiptap/core";

/** Small caps text format (Word: Ctrl+Shift+K). */
export const SmallCaps = Mark.create({
  name: "smallCaps",
  parseHTML: () => [
    { tag: "span[data-small-caps]" },
    {
      style: "font-variant",
      getAttrs: (value) => (String(value).includes("small-caps") ? null : false),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-small-caps": "", style: "font-variant:small-caps" }),
    0,
  ],
  addCommands() {
    return {
      toggleSmallCaps:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-k": () => this.editor.commands.toggleSmallCaps() };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    smallCaps: {
      toggleSmallCaps: () => ReturnType;
    };
  }
}
