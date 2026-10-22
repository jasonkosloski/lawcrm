/**
 * Outlines nodes whose paths fail `checkTemplateFit` (e.g. a matter-only
 * field in a lead template). The host pushes the invalid paths in with
 * `setFitInvalid`; nodes are matched the same way `checkTemplateFit`
 * keys them (field/showIf path, listField/repeat list, `list.itemPath`).
 */

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

const key = new PluginKey<DecorationSet>("fitHighlight");

const OUTLINE = {
  class: "outline outline-2 outline-offset-1 outline-danger rounded",
  "data-fit-invalid": "",
};

function nodeKeys(n: PMNode): string[] {
  const a = n.attrs as Record<string, unknown>;
  switch (n.type.name) {
    case "field":
    case "showIf":
      return [String(a.path ?? "")];
    case "repeat":
      return [String(a.list ?? "")];
    case "listField":
      return [String(a.list ?? ""), `${String(a.list ?? "")}.${String(a.itemPath ?? "")}`];
    default:
      return [];
  }
}

function build(doc: PMNode, invalid: ReadonlySet<string>): DecorationSet {
  if (invalid.size === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((n, pos) => {
    if (nodeKeys(n).some((k) => invalid.has(k))) {
      decos.push(Decoration.node(pos, pos + n.nodeSize, OUTLINE));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const FitHighlight = Extension.create({
  name: "fitHighlight",
  addStorage: () => ({ invalid: new Set<string>() as ReadonlySet<string> }),
  addProseMirrorPlugins() {
    const storage = this.storage as { invalid: ReadonlySet<string> };
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => build(state.doc, storage.invalid),
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(key) ? build(tr.doc, storage.invalid) : old,
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

/** Replace the highlighted paths and redraw. */
export function setFitInvalid(editor: Editor | null, paths: readonly string[]): void {
  if (!editor || editor.isDestroyed) return;
  const storage = (editor.storage as unknown as Record<string, { invalid: ReadonlySet<string> }>)
    .fitHighlight;
  if (!storage) return;
  storage.invalid = new Set(paths);
  editor.view.dispatch(editor.state.tr.setMeta(key, true));
}
