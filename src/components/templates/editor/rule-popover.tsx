/**
 * Logic-section properties. `RuleForm` builds a "Show if" condition
 * (field, test, values) and is used both by the toolbar (to wrap the
 * selection) and by `RulePopover`, which edits or removes the showIf /
 * repeat section whose header was clicked.
 */

"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fieldByPath, type CatalogField, type CatalogList } from "@/lib/templates/catalog";
import type { ShowIfOp } from "@/lib/templates/schema";

export type RuleAttrs = { path: string; op: ShowIfOp; values: string[] };

const OP_LABELS: Record<ShowIfOp, string> = {
  present: "is filled in",
  empty: "is empty",
  true: "is yes",
  false: "is no",
  in: "is one of",
};

/** Tests that make sense for a field type. */
function opsFor(field: CatalogField | undefined): ShowIfOp[] {
  return field?.type === "boolean" ? ["true", "false"] : ["present", "empty", "in"];
}

export function RuleForm({
  fields,
  initial,
  submitLabel,
  onSubmit,
}: {
  fields: CatalogField[];
  initial?: RuleAttrs;
  submitLabel: string;
  onSubmit: (attrs: RuleAttrs) => void;
}) {
  const [path, setPath] = useState(initial?.path ?? fields[0]?.path ?? "");
  const field = fieldByPath(path);
  const ops = opsFor(field);
  const [op, setOp] = useState<ShowIfOp>(initial?.op ?? ops[0]);
  const [values, setValues] = useState((initial?.values ?? []).join(", "));
  const effectiveOp = ops.includes(op) ? op : ops[0];

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const list =
          effectiveOp === "in"
            ? values
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
            : [];
        onSubmit({ path, op: effectiveOp, values: list });
      }}
    >
      <Field label="Field">
        {(c) => (
          <NativeSelect
            {...c}
            className="w-full"
            size="sm"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          >
            {fields.map((f) => (
              <NativeSelectOption key={f.path} value={f.path}>
                {f.group} · {f.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label="Test">
        {(c) => (
          <NativeSelect
            {...c}
            className="w-full"
            size="sm"
            value={effectiveOp}
            onChange={(e) => setOp(e.target.value as ShowIfOp)}
          >
            {ops.map((o) => (
              <NativeSelectOption key={o} value={o}>
                {OP_LABELS[o]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
      {effectiveOp === "in" && (
        <Field label="Values" hint="Separate values with commas.">
          {(c) => (
            <input
              {...c}
              value={values}
              onChange={(e) => setValues(e.target.value)}
              className={cn(inputClass(), "w-full")}
            />
          )}
        </Field>
      )}
      <Button type="submit" size="sm" className="self-end">
        {submitLabel}
      </Button>
    </form>
  );
}

/** Replace the section at `pos` with its own content (minus "If none:"). */
function unwrap(editor: Editor, pos: number, node: PMNode) {
  const kids: PMNode[] = [];
  node.content.forEach((c) => {
    if (c.type.name !== "repeatEmpty") kids.push(c);
  });
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(pos, pos + node.nodeSize, Fragment.from(kids));
      return true;
    })
    .run();
}

export function RulePopover({
  editor,
  pos,
  fields,
  lists,
  onClose,
}: {
  editor: Editor;
  pos: number;
  fields: CatalogField[];
  lists: CatalogList[];
  onClose: () => void;
}) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "showIf" && node.type.name !== "repeat")) return null;
  const anchor = editor.view.nodeDOM(pos) as Element | null;
  const isRepeat = node.type.name === "repeat";
  const hasEmpty = node.lastChild?.type.name === "repeatEmpty";

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverContent anchor={anchor} align="start" className="w-80">
        {isRepeat ? (
          <div className="flex flex-col gap-2">
            <Field label="Repeat for each">
              {(c) => (
                <NativeSelect
                  {...c}
                  className="w-full"
                  size="sm"
                  value={String(node.attrs.list)}
                  onChange={(e) => {
                    editor.commands.updateNodeAttrs(pos, { list: e.target.value });
                    onClose();
                  }}
                >
                  {lists.map((l) => (
                    <NativeSelectOption key={l.path} value={l.path}>
                      {l.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </Field>
            {!hasEmpty && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  editor.commands.addRepeatEmpty(pos);
                  onClose();
                }}
              >
                Add text for when the list is empty
              </Button>
            )}
          </div>
        ) : (
          <RuleForm
            fields={fields}
            initial={node.attrs as RuleAttrs}
            submitLabel="Update condition"
            onSubmit={(attrs) => {
              editor.commands.updateNodeAttrs(pos, attrs);
              onClose();
            }}
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-danger"
          onClick={() => {
            unwrap(editor, pos, node);
            onClose();
          }}
        >
          {isRepeat ? "Remove repeat (keep text)" : "Remove condition (keep text)"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
