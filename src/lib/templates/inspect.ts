/**
 * Template inspection: which catalog paths and blocks a template uses, and
 * whether those paths fit a template's `appliesTo`. Walks validated
 * TemplateDoc trees; unknown shapes are ignored rather than thrown on.
 */

import { fieldByPath, listByPath, type Scope } from "./catalog";
import type { BlockSource } from "./render";
import {
  MAX_BLOCK_DEPTH,
  SCOPE_WORD,
  scopeCovers,
  type AppliesTo,
  type TemplateDoc,
} from "./schema";

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

/** `ok` is field fit only: unknown styles are reported but never fail it. */
export type FitResult =
  | { ok: true; unknownStyles?: UnknownStyle[] }
  | { ok: false; invalid: Invalid[]; unknownStyles?: UnknownStyle[] };

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
  const unknownStyles = unknown.size ? [...unknown.values()] : undefined;
  if (invalid.size === 0) return unknownStyles ? { ok: true, unknownStyles } : { ok: true };
  return unknownStyles
    ? { ok: false, invalid: [...invalid.values()], unknownStyles }
    : { ok: false, invalid: [...invalid.values()] };
}

export type NestedMisfit = {
  path: string;
  label: string | null;
  /** Block names, outermost first. */
  via: string[];
};

/** `"Case number (in Signature → Attorney contact)"`. */
export const nestedMisfitText = (m: NestedMisfit): string =>
  `${m.label ?? m.path} (in ${m.via.join(" → ")})`;

/** Misfits inside blocks nested (at any depth) in `doc`, each with the
 *  chain of block names leading to it. Content is checked against the
 *  host's `appliesTo`; a nested block whose own scope doesn't cover its
 *  parent block is reported as `block:<id>`. Misfits directly in `doc` are
 *  `checkTemplateFit`'s. A block already on the chain is skipped, and
 *  chains stop at MAX_BLOCK_DEPTH. */
export function checkNestedFit(
  doc: TemplateDoc,
  appliesTo: AppliesTo,
  blocks: ReadonlyMap<string, BlockSource>,
): NestedMisfit[] {
  const required = SCOPES[appliesTo];
  const out = new Map<string, NestedMisfit>();
  const add = (m: NestedMisfit) => {
    const key = `${m.via.join("\u0000")}\u0001${m.path}`;
    if (!out.has(key)) out.set(key, m);
  };
  const visit = (host: TemplateDoc, parentScope: AppliesTo | null, chain: BlockSource[]) => {
    if (chain.length >= MAX_BLOCK_DEPTH) return;
    for (const id of collectBlockIds(host)) {
      const b = blocks.get(id);
      if (!b || chain.some((c) => c.id === id)) continue;
      const scope = b.appliesTo ?? "both";
      const via = [...chain, b].map((c) => c.name);
      if (parentScope && !scopeCovers(scope, parentScope)) {
        add({
          path: `block:${b.id}`,
          label: `${b.name} applies to ${SCOPE_WORD[scope]} only`,
          via: via.slice(0, -1),
        });
      }
      const invalid = new Map<string, Invalid>();
      check(b.content, required, invalid);
      for (const m of invalid.values()) add({ ...m, via });
      visit(b.content, scope, [...chain, b]);
    }
  };
  visit(doc, null, []);
  return [...out.values()];
}

/** True when any field path starts with `prefix`, looking through
 *  referenced blocks at every level (each block visited once, so a loop
 *  terminates). */
export function usesPrefix(
  doc: TemplateDoc,
  prefix: "signer." | "recipient.",
  blocks?: Map<string, BlockSource>,
): boolean {
  const hit = (d: TemplateDoc) => collectFieldPaths(d).some((p) => p.startsWith(prefix));
  if (hit(doc)) return true;
  if (!blocks) return false;
  const seen = new Set<string>();
  const queue = collectBlockIds(doc);
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const b = blocks.get(id);
    if (!b) continue;
    if (hit(b.content)) return true;
    queue.push(...collectBlockIds(b.content));
  }
  return false;
}

export const usesSigner = (doc: TemplateDoc, blocks?: Map<string, BlockSource>) =>
  usesPrefix(doc, "signer.", blocks);
export const usesRecipient = (doc: TemplateDoc, blocks?: Map<string, BlockSource>) =>
  usesPrefix(doc, "recipient.", blocks);
