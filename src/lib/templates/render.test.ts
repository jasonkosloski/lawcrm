import { describe, expect, it, vi } from "vitest";
import { SAMPLE_TEMPLATE_DATA, type CatalogField, type TemplateData } from "./catalog";

// The catalog has no boolean fields yet; inject one so true/false are testable.
let flag: boolean | null = true;
vi.mock("./catalog", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./catalog")>();
  const flagField: CatalogField = {
    path: "test.flag",
    label: "Flag",
    group: "Matter",
    type: "boolean",
    scopes: ["matter", "lead"],
    formats: [],
    defaultFormat: null,
    get: () => flag,
  };
  return {
    ...orig,
    fieldByPath: (p: string) => (p === "test.flag" ? flagField : orig.fieldByPath(p)),
  };
});
import { renderTemplate, type BlockSource, type ResolvedNode } from "./render";
import type { BlockNode, InlineNode, TemplateDoc } from "./schema";

const doc = (...content: BlockNode[]): TemplateDoc => ({ type: "doc", content });
const p = (...content: InlineNode[]): BlockNode => ({ type: "paragraph", content });
const t = (text: string): InlineNode => ({ type: "text", text });
const f = (path: string, format: string | null = null): InlineNode => ({
  type: "field",
  attrs: { path, format },
});

const data = (over: Partial<TemplateData> = {}): TemplateData => ({
  ...SAMPLE_TEMPLATE_DATA,
  ...over,
});
const none = new Map<string, BlockSource>();
const render = (d: TemplateDoc, td = data(), blocks = none) =>
  renderTemplate(d, { data: td, blocks });

function textOf(n: ResolvedNode | { content?: ResolvedNode[]; text?: string }): string {
  if ("text" in n && typeof n.text === "string") return n.text;
  if ("type" in n && n.type === "hardBreak") return "\n";
  return ((n as { content?: ResolvedNode[] }).content ?? []).map(textOf).join("");
}
const paras = (r: ReturnType<typeof render>) => (r.doc.content ?? []).map(textOf);

describe("fields", () => {
  it("resolves with format and keeps marks", () => {
    const r = render(
      doc(
        p({
          type: "field",
          attrs: { path: "client.name", format: "last" },
          marks: [{ type: "bold" }],
        }),
      ),
      data({ client: { ...SAMPLE_TEMPLATE_DATA.client!, name: "Mary Ann Smith" } }),
    );
    expect(r.doc.content![0]).toMatchObject({
      content: [{ type: "text", text: "Smith", marks: [{ type: "bold" }] }],
    });
    expect(r.report).toEqual({ missing: [], invalid: [], archivedBlocks: [] });
  });

  it("missing value renders a labelled placeholder", () => {
    const r = render(doc(p(f("client.address"))), data({ client: null }));
    expect(r.doc.content![0]).toMatchObject({
      content: [
        { type: "text", text: "[Client address — not on file]", marks: [{ type: "missing" }] },
      ],
    });
    expect(r.report.missing).toEqual(["Client address"]);
  });

  it("dedupes report entries", () => {
    const r = render(doc(p(f("client.address"), f("client.address"))), data({ client: null }));
    expect(r.report.missing).toEqual(["Client address"]);
  });

  it("unknown and wrong-scope paths are invalid, never throw", () => {
    const r = render(
      doc(p(f("nope.nothing")), p(f("matter.caseNumber"))),
      data({ scope: "lead", matter: null }),
    );
    expect(paras(r)).toEqual(["{{nope.nothing}}", "{{matter.caseNumber}}"]);
    expect(r.report.invalid).toEqual(["nope.nothing", "matter.caseNumber"]);
  });

  it("disallowed format falls back to the default", () => {
    const r = render(doc(p(f("client.name", "iso"))), data());
    expect(paras(r)[0]).toBe(SAMPLE_TEMPLATE_DATA.client!.name);
  });

  it("address block format becomes hard breaks", () => {
    const r = render(doc(p(f("client.address", "block"))));
    const kinds = (r.doc.content![0] as { content: { type: string }[] }).content.map((c) => c.type);
    expect(kinds).toEqual(["text", "hardBreak", "text"]);
  });
});

describe("blocks", () => {
  const sig: BlockSource = {
    id: "b1",
    name: "Signature",
    isActive: true,
    content: doc(p(t("Sincerely"))),
  };
  const blockRef = (id: string): BlockNode => ({ type: "block", attrs: { blockId: id } });

  it("inlines active block content", () => {
    const r = render(doc(p(t("Hi")), blockRef("b1")), data(), new Map([["b1", sig]]));
    expect(paras(r)).toEqual(["Hi", "Sincerely"]);
  });

  it("archived block renders a marker", () => {
    const r = render(doc(blockRef("b1")), data(), new Map([["b1", { ...sig, isActive: false }]]));
    expect(paras(r)).toEqual(["[Signature block — archived]"]);
    expect(r.doc.content![0]).toMatchObject({ content: [{ marks: [{ type: "missing" }] }] });
    expect(r.report.archivedBlocks).toEqual(["Signature"]);
  });

  it("unknown block id renders [Missing block]", () => {
    const r = render(doc(blockRef("zzz")));
    expect(paras(r)).toEqual(["[Missing block]"]);
    expect(r.report.archivedBlocks).toEqual(["(deleted)"]);
  });

  it("does not recurse into nested blocks", () => {
    const nested: BlockSource = { ...sig, content: doc(blockRef("b1")) };
    const r = render(doc(blockRef("b1")), data(), new Map([["b1", nested]]));
    expect(paras(r)).toEqual(["[Missing block]"]);
  });
});

describe("showIf", () => {
  const si = (
    path: string,
    op: "present" | "empty" | "true" | "false" | "in",
    values: string[] = [],
  ): BlockNode => ({
    type: "showIf",
    attrs: { path, op, values },
    content: [p(t("shown"))],
  });
  const shown = (n: BlockNode, td = data()) => paras(render(doc(n), td));

  it("present / empty", () => {
    expect(shown(si("matter.caseNumber", "present"))).toEqual(["shown"]);
    expect(shown(si("matter.caseNumber", "empty"))).toEqual([]);
    const blank = data({ matter: { ...SAMPLE_TEMPLATE_DATA.matter!, caseNumber: null } });
    expect(shown(si("matter.caseNumber", "present"), blank)).toEqual([]);
    expect(shown(si("matter.caseNumber", "empty"), blank)).toEqual(["shown"]);
  });

  it("true / false against boolean fields", () => {
    flag = true;
    expect(shown(si("test.flag", "true"))).toEqual(["shown"]);
    expect(shown(si("test.flag", "false"))).toEqual([]);
    flag = false;
    expect(shown(si("test.flag", "true"))).toEqual([]);
    expect(shown(si("test.flag", "false"))).toEqual(["shown"]);
    flag = null;
    expect(shown(si("test.flag", "true"))).toEqual([]);
    expect(shown(si("test.flag", "false"))).toEqual([]);
  });

  it("in is case-insensitive and trimmed", () => {
    const td = data({ matter: { ...SAMPLE_TEMPLATE_DATA.matter!, stage: "Discovery" } });
    expect(shown(si("matter.stage", "in", [" discovery ", "x"]), td)).toEqual(["shown"]);
    expect(shown(si("matter.stage", "in", ["trial"]), td)).toEqual([]);
  });

  it("invalid path drops children and reports", () => {
    const r = render(doc(si("bogus.path", "present")));
    expect(paras(r)).toEqual([]);
    expect(r.report.invalid).toEqual(["bogus.path"]);
  });
});

describe("repeat", () => {
  const rep = (...inner: BlockNode[]): BlockNode => ({
    type: "repeat",
    attrs: { list: "parties.defendants" },
    content: [
      p(t("- "), f("item.name")),
      ...inner,
      { type: "repeatEmpty", content: [p(t("None"))] },
    ],
  });
  const withDefs = (names: string[]) =>
    data({
      parties: {
        ...SAMPLE_TEMPLATE_DATA.parties,
        defendants: names.map((name) => ({
          ...SAMPLE_TEMPLATE_DATA.parties.defendants[0],
          name,
        })),
      },
    });

  it("empty list renders repeatEmpty", () => {
    expect(paras(render(doc(rep()), withDefs([])))).toEqual(["None"]);
  });

  it("renders body per item", () => {
    expect(paras(render(doc(rep()), withDefs(["Ann", "Bob"])))).toEqual(["- Ann", "- Bob"]);
  });

  it("nested showIf sees the item", () => {
    const inner: BlockNode = {
      type: "showIf",
      attrs: { path: "item.name", op: "in", values: ["bob"] },
      content: [p(t("is bob"))],
    };
    expect(paras(render(doc(rep(inner)), withDefs(["Ann", "Bob"])))).toEqual([
      "- Ann",
      "- Bob",
      "is bob",
    ]);
  });

  it("item.* outside repeat is invalid", () => {
    const r = render(doc(p(f("item.name"))));
    expect(paras(r)).toEqual(["{{item.name}}"]);
    expect(r.report.invalid).toEqual(["item.name"]);
  });

  it("unknown list is invalid and renders nothing", () => {
    const r = render(doc({ type: "repeat", attrs: { list: "nope" }, content: [p(t("x"))] }));
    expect(paras(r)).toEqual([]);
    expect(r.report.invalid).toEqual(["nope"]);
  });
});

describe("listField", () => {
  const lf = (join: "and" | "oxford_and" | "lines"): BlockNode =>
    p({ type: "listField", attrs: { list: "parties.defendants", itemPath: "name", join } });
  const td = (names: string[]) =>
    data({
      parties: {
        ...SAMPLE_TEMPLATE_DATA.parties,
        defendants: names.map((name) => ({
          ...SAMPLE_TEMPLATE_DATA.parties.defendants[0],
          name,
        })),
      },
    });

  it("oxford_and", () => {
    expect(paras(render(doc(lf("oxford_and")), td(["A", "B", "C"])))).toEqual(["A, B, and C"]);
  });

  it("lines uses hardBreaks", () => {
    const r = render(doc(lf("lines")), td(["A", "B"]));
    const kinds = (r.doc.content![0] as { content: { type: string }[] }).content.map((c) => c.type);
    expect(kinds).toEqual(["text", "hardBreak", "text"]);
  });

  it("empty list yields an empty paragraph, no placeholder", () => {
    const r = render(doc(lf("and")), td([]));
    expect(r.doc.content![0]).toEqual({ type: "paragraph" });
    expect(r.report.missing).toEqual([]);
  });
});
