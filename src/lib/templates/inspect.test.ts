import { describe, expect, it } from "vitest";
import {
  checkNestedFit,
  checkTemplateFit,
  nestedMisfitText,
  collectBlockIds,
  collectFieldPaths,
  usesPrefix,
  usesRecipient,
  usesSigner,
} from "./inspect";
import type { BlockSource } from "./render";
import type { TemplateDoc } from "./schema";

const f = (path: string) => ({ type: "field" as const, attrs: { path, format: null } });
const para = (...c: unknown[]) => ({ type: "paragraph" as const, content: c as never[] });
const doc = (...c: unknown[]): TemplateDoc => ({ type: "doc", content: c as never[] });

describe("collectFieldPaths / collectBlockIds", () => {
  it("collects fields, showIf and list paths, excluding item.*", () => {
    const d = doc(
      para(f("matter.name")),
      {
        type: "showIf",
        attrs: { path: "matter.caseNumber", op: "present", values: [] },
        content: [para(f("matter.name"))],
      },
      { type: "repeat", attrs: { list: "parties.plaintiffs" }, content: [para(f("item.name"))] },
      para({
        type: "listField",
        attrs: { list: "parties.defendants", itemPath: "name", join: "and" },
      }),
      { type: "block", attrs: { blockId: "b1" } },
    );
    expect(collectFieldPaths(d)).toEqual([
      "matter.name",
      "matter.caseNumber",
      "parties.plaintiffs",
      "parties.defendants",
    ]);
    expect(collectBlockIds(d)).toEqual(["b1"]);
  });
});

describe("checkTemplateFit", () => {
  const d = doc(para(f("matter.caseNumber")));
  it("accepts matter-only fields for matter and refuses for lead and both", () => {
    expect(checkTemplateFit(d, "matter")).toEqual({ ok: true });
    for (const a of ["lead", "both"] as const) {
      const r = checkTemplateFit(d, a);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.invalid).toHaveLength(1);
        expect(r.invalid[0].path).toBe("matter.caseNumber");
        expect(r.invalid[0].label).toEqual(expect.any(String));
      }
    }
  });
  it("reports unknown paths with null label, de-duplicated", () => {
    const r = checkTemplateFit(doc(para(f("nope.x"), f("nope.x"))), "matter");
    expect(r).toEqual({ ok: false, invalid: [{ path: "nope.x", label: null }] });
  });
  it("checks the subject too", () => {
    const r = checkTemplateFit(doc(para(f("matter.name"))), "matter", doc(para(f("zzz"))));
    expect(r).toEqual({ ok: false, invalid: [{ path: "zzz", label: null }] });
  });
  it("checks item.* against the repeat list and rejects it outside", () => {
    const ok = doc({
      type: "repeat",
      attrs: { list: "parties.plaintiffs" },
      content: [para(f("item.name"))],
    });
    expect(checkTemplateFit(ok, "matter")).toEqual({ ok: true });
    const bad = doc({
      type: "repeat",
      attrs: { list: "parties.plaintiffs" },
      content: [para(f("item.bogus"))],
    });
    expect(checkTemplateFit(bad, "matter")).toEqual({
      ok: false,
      invalid: [{ path: "item.bogus", label: null }],
    });
    expect(checkTemplateFit(doc(para(f("item.name"))), "matter").ok).toBe(false);
  });
  it("flags a bad listField itemPath", () => {
    const d2 = doc(
      para({
        type: "listField",
        attrs: { list: "parties.plaintiffs", itemPath: "bogus", join: "and" },
      }),
    );
    expect(checkTemplateFit(d2, "matter").ok).toBe(false);
  });
});

describe("checkTemplateFit paragraph styles", () => {
  const styled = (style: string) => ({
    type: "paragraph" as const,
    attrs: { style },
    content: [],
  });
  const d = doc(styled("old-style"), styled("body"), styled("old-style"));

  it("reports unknown styles once each", () => {
    const r = checkTemplateFit(d, "matter", null, new Set(["body"]));
    expect(r).toEqual({
      ok: true,
      unknownStyles: [{ kind: "style", key: "old-style", label: "Unknown style: old-style" }],
    });
  });
  it("passes when styles are known, or when no style set is given", () => {
    expect(checkTemplateFit(d, "matter", null, new Set(["body", "old-style"]))).toEqual({
      ok: true,
    });
    expect(checkTemplateFit(d, "matter")).toEqual({ ok: true });
  });
  it("finds styles nested in containers", () => {
    const nested = doc({
      type: "showIf",
      attrs: { path: "matter.caseNumber" },
      content: [styled("gone")],
    });
    const r = checkTemplateFit(nested, "matter", null, new Set(["body"]));
    expect(r.ok).toBe(true);
    expect(r.unknownStyles).toHaveLength(1);
  });
  it("keeps field misfits failing, with unknown styles alongside", () => {
    const r = checkTemplateFit(
      doc(para(f("matter.caseNumber")), styled("gone")),
      "lead",
      null,
      new Set(["body"]),
    );
    expect(r.ok).toBe(false);
    expect(r.unknownStyles).toHaveLength(1);
  });
});

describe("usesPrefix", () => {
  const block: BlockSource = {
    id: "b1",
    name: "B",
    isActive: true,
    content: doc(para(f("signer.name"))),
  };
  const blocks = new Map([["b1", block]]);
  const d = doc({ type: "block", attrs: { blockId: "b1" } });
  it("sees signer inside a referenced block only when blocks given", () => {
    expect(usesPrefix(d, "signer.", blocks)).toBe(true);
    expect(usesPrefix(d, "signer.")).toBe(false);
    expect(usesPrefix(d, "recipient.", blocks)).toBe(false);
  });
  it("sees signer two levels down", () => {
    const outer: BlockSource = {
      id: "b0",
      name: "Outer",
      isActive: true,
      content: doc({ type: "block", attrs: { blockId: "b1" } }),
    };
    const nested = new Map([...blocks, ["b0", outer]]);
    const top = doc({ type: "block", attrs: { blockId: "b0" } });
    expect(usesSigner(top, nested)).toBe(true);
    expect(usesRecipient(top, nested)).toBe(false);
  });
  it("terminates on a block loop", () => {
    const a: BlockSource = {
      ...block,
      id: "a",
      content: doc({ type: "block", attrs: { blockId: "b" } }),
    };
    const b: BlockSource = {
      ...block,
      id: "b",
      content: doc({ type: "block", attrs: { blockId: "a" } }),
    };
    const loop = new Map([
      ["a", a],
      ["b", b],
    ]);
    expect(usesSigner(doc({ type: "block", attrs: { blockId: "a" } }), loop)).toBe(false);
  });
  it("sees direct use", () => {
    expect(usesPrefix(doc(para(f("recipient.name"))), "recipient.")).toBe(true);
  });
});

describe("checkNestedFit", () => {
  const blk = (
    id: string,
    name: string,
    content: TemplateDoc,
    appliesTo?: "matter" | "lead" | "both",
  ): BlockSource => ({ id, name, isActive: true, content, appliesTo });
  const ref = (blockId: string) => ({ type: "block" as const, attrs: { blockId } });
  const map = (...bs: BlockSource[]) => new Map(bs.map((b) => [b.id, b]));

  it("reports a misfit two blocks down with its path", () => {
    const blocks = map(
      blk("a", "A", doc(para(ref("b")))),
      blk("b", "B", doc(para(f("matter.caseNumber")))),
    );
    const r = checkNestedFit(doc(para(ref("a"))), "lead", blocks);
    expect(r).toHaveLength(1);
    expect(r[0].via).toEqual(["A", "B"]);
    expect(nestedMisfitText(r[0])).toBe("Case number (in A → B)");
  });

  it("reports a nested block whose scope doesn't cover its parent", () => {
    const blocks = map(
      blk("a", "A", doc(para(ref("b"))), "lead"),
      blk("b", "B", doc(para()), "matter"),
    );
    const r = checkNestedFit(doc(para(ref("a"))), "lead", blocks);
    expect(r).toEqual([{ path: "block:b", label: "B applies to matter only", via: ["A"] }]);
  });

  it("is loop-safe", () => {
    const blocks = map(
      blk("a", "A", doc(para(ref("b")))),
      blk("b", "B", doc(para(ref("a"), f("matter.caseNumber")))),
    );
    const r = checkNestedFit(doc(para(ref("a"))), "lead", blocks);
    expect(r.map((m) => m.via)).toEqual([["A", "B"]]);
  });

  it("an empty list when everything fits", () => {
    const blocks = map(blk("a", "A", doc(para(f("matter.caseNumber")))));
    expect(checkNestedFit(doc(para(ref("a"))), "matter", blocks)).toEqual([]);
    expect(checkNestedFit(doc(para(f("matter.caseNumber"))), "lead", blocks)).toEqual([]);
  });
});
