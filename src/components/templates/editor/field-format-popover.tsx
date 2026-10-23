/**
 * Properties of a clicked field chip. A `field` has its format (dates,
 * names, addresses, text case) and what prints when it has no value; a
 * `listField` has its item field and join style. Both have Remove.
 * Changes apply immediately.
 */

"use client";

import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { listByPath } from "@/lib/templates/catalog";
import { JOIN_STYLES } from "@/lib/templates/schema";
import { FORMAT_LABELS, JOIN_LABELS, resolveField } from "./labels";

/** The list of the nearest repeat enclosing `pos`, if any. */
export function repeatListAt(editor: Editor, pos: number): string | null {
  const $pos = editor.state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (n.type.name === "repeat") return String(n.attrs.list);
  }
  return null;
}

export function FieldFormatPopover({
  editor,
  pos,
  onClose,
}: {
  editor: Editor;
  pos: number;
  onClose: () => void;
}) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "field" && node.type.name !== "listField")) return null;
  const anchor = editor.view.nodeDOM(pos) as Element | null;
  const set = (attrs: Record<string, unknown>) => editor.commands.updateNodeAttrs(pos, attrs);
  const remove = () => {
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
    onClose();
  };

  let body: React.ReactNode;
  if (node.type.name === "field") {
    const path = String(node.attrs.path);
    const field = resolveField(path, repeatListAt(editor, pos));
    body = (
      <>
        <div className="text-xs font-medium text-ink">{field?.label ?? path}</div>
        {field && field.formats.length > 0 && (
          <Field label="Format">
            {(c) => (
              <NativeSelect
                {...c}
                size="sm"
                className="w-full"
                value={String(node.attrs.format ?? "")}
                onChange={(e) => set({ format: e.target.value || null })}
              >
                <NativeSelectOption value="">
                  Default
                  {field.defaultFormat ? ` (${FORMAT_LABELS[field.defaultFormat]})` : ""}
                </NativeSelectOption>
                {field.formats.map((f) => (
                  <NativeSelectOption key={f} value={f}>
                    {FORMAT_LABELS[f] ?? f}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
        {field && (
          <Field label="If missing">
            {(c) => (
              <NativeSelect
                {...c}
                size="sm"
                className="w-full"
                value={node.attrs.ifMissing === "hide" ? "hide" : "show"}
                onChange={(e) => set({ ifMissing: e.target.value === "hide" ? "hide" : null })}
              >
                <NativeSelectOption value="show">Show as missing</NativeSelectOption>
                <NativeSelectOption value="hide">Leave blank</NativeSelectOption>
              </NativeSelect>
            )}
          </Field>
        )}
      </>
    );
  } else {
    const list = listByPath(String(node.attrs.list));
    body = (
      <>
        <div className="text-xs font-medium text-ink">{list?.label ?? String(node.attrs.list)}</div>
        {list && (
          <Field label="Show each">
            {(c) => (
              <NativeSelect
                {...c}
                size="sm"
                className="w-full"
                value={String(node.attrs.itemPath)}
                onChange={(e) => set({ itemPath: e.target.value })}
              >
                {list.itemFields.map((f) => (
                  <NativeSelectOption key={f.path} value={f.path}>
                    {f.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
        <Field label="Join with">
          {(c) => (
            <NativeSelect
              {...c}
              size="sm"
              className="w-full"
              value={String(node.attrs.join)}
              onChange={(e) => set({ join: e.target.value })}
            >
              {JOIN_STYLES.map((j) => (
                <NativeSelectOption key={j} value={j}>
                  {JOIN_LABELS[j]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </Field>
      </>
    );
  }

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverContent anchor={anchor} align="start" className="w-64">
        {body}
        <Button variant="ghost" size="sm" className="self-start text-danger" onClick={remove}>
          Remove field
        </Button>
      </PopoverContent>
    </Popover>
  );
}
