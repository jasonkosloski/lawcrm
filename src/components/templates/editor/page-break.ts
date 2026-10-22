import { mergeAttributes, Node } from "@tiptap/core";

/** A hard page break (letters and filings; not allowed in email). */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "hr[data-page-break]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "hr",
    mergeAttributes(HTMLAttributes, {
      "data-page-break": "",
      class: "my-3 border-dashed border-line-2",
      title: "Page break",
    }),
  ],
  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      insertPageBreak: () => ReturnType;
    };
  }
}
