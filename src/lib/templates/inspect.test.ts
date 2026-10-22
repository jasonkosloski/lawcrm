import { describe, expect, it } from "vitest";
import { checkTemplateFit, collectBlockIds, collectFieldPaths, usesPrefix } from "./inspect";
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
  it("sees direct use", () => {
    expect(usesPrefix(doc(para(f("recipient.name"))), "recipient.")).toBe(true);
  });
});
