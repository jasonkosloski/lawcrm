/** Shared test fixture: a document using every template node and mark. */

/** Every paragraph attr at its default: what the editor emits. */
export const NO_ATTRS = {
  textAlign: null,
  style: null,
  spaceBeforePt: null,
  spaceAfterPt: null,
  lineSpacing: null,
  indentLeftIn: null,
  indentRightIn: null,
  firstLine: null,
  keepWithNext: null,
  keepLinesTogether: null,
  pageBreakBefore: null,
};
export const p = (...content: unknown[]) => ({
  type: "paragraph",
  attrs: NO_ATTRS,
  content,
});
export const t = (text: string, marks?: { type: string; attrs?: unknown }[]) =>
  marks ? { type: "text", text, marks } : { type: "text", text };
export const cell = (type: "tableCell" | "tableHeader", ...content: unknown[]) => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null, verticalAlign: null, borders: null },
  content,
});

export const FULL_DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { ...NO_ATTRS, style: "heading1", textAlign: "center" },
      content: [t("Title")],
    },
    p(
      t("Dear "),
      { type: "field", attrs: { path: "client.name", format: "full" }, marks: [{ type: "bold" }] },
      { type: "hardBreak" },
      t("styled", [{ type: "italic" }, { type: "underline" }]),
      t(" Plaintiff", [{ type: "smallCaps" }]),
      { type: "field", attrs: { path: "matter.name", format: null } },
    ),
    p({
      type: "listField",
      attrs: { list: "parties.clients", itemPath: "name", join: "oxford_and" },
    }),
    { type: "bulletList", content: [{ type: "listItem", content: [p(t("one"))] }] },
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [{ type: "listItem", content: [p(t("first"))] }],
    },
    {
      type: "table",
      attrs: { width: null },
      content: [
        { type: "tableRow", content: [cell("tableHeader", p(t("H")))] },
        { type: "tableRow", content: [cell("tableCell", p(t("c")))] },
      ],
    },
    { type: "pageBreak" },
    { type: "block", attrs: { blockId: "blk1" } },
    {
      type: "showIf",
      attrs: { path: "matter.name", op: "in", values: ["a", "b"] },
      content: [p(t("cond"))],
    },
    {
      type: "repeat",
      attrs: { list: "parties.clients" },
      content: [
        p({ type: "field", attrs: { path: "item.name", format: null } }),
        { type: "repeatEmpty", content: [p(t("none"))] },
      ],
    },
  ],
};
