/**
 * Template inspection: which catalog paths and blocks a template uses, and
 * whether those paths fit a template's `appliesTo`. Walks validated
 * TemplateDoc trees; unknown shapes are ignored rather than thrown on.
 */

import { fieldByPath, listByPath, type Scope } from "./catalog";
import type { BlockSource } from "./render";
import type { AppliesTo, TemplateDoc } from "./schema";

type AnyNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: AnyNode[];
};

/** Depth-first walk. `list` is the enclosing repeat's list path, if any. */
function walk(
  node: AnyNode,
  list: string | null,
  visit: (n: AnyNode, list: string | null) => void,
) {
  visit(node, list);
  const inner =
    node.type === "repeat" && typeof node.attrs?.list === "string" ? node.attrs.list : list;
  for (const child of node.content ?? []) walk(child, inner, visit);
}

const attr = (n: AnyNode, key: string): string | null => {
  const v = n.attrs?.[key];
  return typeof v === "string" ? v : null;
};

/** Absolute paths a node refers to, with the repeat list that gives
 *  `item.*` paths meaning. */
function refs(n: AnyNode, list: string | null): { path: string; list: string | null }[] {
  switch (n.type) {
    case "field":
    case "showIf": {
      const p = attr(n, "path");
      return p ? [{ path: p, list }] : [];
    }
    case "listField": {
      const out: { path: string; list: string | null }[] = [];
      const l = attr(n, "list");
      if (l) out.push({ path: l, list });
      return out;
    }
    case "repeat": {
      const l = attr(n, "list");
      return l ? [{ path: l, list }] : [];
    }
    default:
      return [];
  }
}

export function collectFieldPaths(doc: TemplateDoc): string[] {
  const seen = new Set<string>();
  walk(doc, null, (n, list) => {
    for (const r of refs(n, list)) if (!r.path.startsWith("item.")) seen.add(r.path);
  });
  return [...seen];
}

export function collectBlockIds(doc: TemplateDoc): string[] {
  const seen = new Set<string>();
  walk(doc, null, (n) => {
    if (n.type === "block") {
      const id = attr(n, "blockId");
      if (id) seen.add(id);
    }
  });
  return [...seen];
}

const SCOPES: Record<AppliesTo, Scope[]> = {
  matter: ["matter"],
  lead: ["lead"],
  both: ["matter", "lead"],
};

type Invalid = { path: string; label: string | null };

/** A paragraph style key no longer in the firm's list. */
export type UnknownStyle = { kind: "style"; key: string; label: string };

export type FitResult =
  { ok: true } | { ok: false; invalid: Invalid[]; unknownStyles?: UnknownStyle[] };

function check(doc: TemplateDoc, required: Scope[], invalid: Map<string, Invalid>): void {
  const fits = (scopes: Scope[]) => required.every((s) => scopes.includes(s));
  walk(doc, null, (n, list) => {
    // listField.itemPath is relative to its list.
    if (n.type === "listField") {
      const l = attr(n, "list");
      const ip = attr(n, "itemPath");
      const cl = l ? listByPath(l) : undefined;
      if (ip && !cl?.itemFields.some((f) => f.path === ip)) {
        const key = l ? `${l}.${ip}` : ip;
        if (!invalid.has(key)) invalid.set(key, { path: key, label: null });
      }
    }
    for (const r of refs(n, list)) {
      if (invalid.has(r.path)) continue;
      if (r.path.startsWith("item.")) {
        const sub = r.path.slice("item.".length);
        const cl = r.list ? listByPath(r.list) : undefined;
        const f = cl?.itemFields.find((x) => x.path === sub);
        if (!f) invalid.set(r.path, { path: r.path, label: null });
        continue;
      }
      const entry =
        n.type === "listField" || n.type === "repeat" ? listByPath(r.path) : fieldByPath(r.path);
      if (!entry) invalid.set(r.path, { path: r.path, label: null });
      else if (!fits(entry.scopes)) invalid.set(r.path, { path: r.path, label: entry.label });
    }
  });
}

/** Paths unknown, or not valid in every scope `appliesTo` implies. Block
 *  contents are not checked: blocks are shared across scopes. */
export function checkTemplateFit(
  doc: TemplateDoc,
  appliesTo: AppliesTo,
  subject?: TemplateDoc | null,
  styleKeys?: Set<string>,
): FitResult {
  const invalid = new Map<string, Invalid>();
  const required = SCOPES[appliesTo];
  check(doc, required, invalid);
  if (subject) check(subject, required, invalid);
  const unknown = new Map<string, UnknownStyle>();
  if (styleKeys) {
    walk(doc, null, (n) => {
      const key = n.type === "paragraph" ? attr(n, "style") : null;
      if (key && !styleKeys.has(key))
        unknown.set(key, { kind: "style", key, label: `Unknown style: ${key}` });
    });
  }
  if (invalid.size === 0 && unknown.size === 0) return { ok: true };
  const result: FitResult = { ok: false, invalid: [...invalid.values()] };
  if (unknown.size) result.unknownStyles = [...unknown.values()];
  return result;
}

/** True when any field path starts with `prefix`, looking one level into
 *  referenced blocks (blocks cannot contain blocks). */
export function usesPrefix(
  doc: TemplateDoc,
  prefix: "signer." | "recipient.",
  blocks?: Map<string, BlockSource>,
): boolean {
  const hit = (d: TemplateDoc) => collectFieldPaths(d).some((p) => p.startsWith(prefix));
  if (hit(doc)) return true;
  if (!blocks) return false;
  return collectBlockIds(doc).some((id) => {
    const b = blocks.get(id);
    return b ? hit(b.content) : false;
  });
}

export const usesSigner = (doc: TemplateDoc, blocks?: Map<string, BlockSource>) =>
  usesPrefix(doc, "signer.", blocks);
export const usesRecipient = (doc: TemplateDoc, blocks?: Map<string, BlockSource>) =>
  usesPrefix(doc, "recipient.", blocks);
