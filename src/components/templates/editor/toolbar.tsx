/**
 * Template editor toolbar: text formatting, lists, tables and page
 * breaks (rich kinds only), plus the template-specific inserts — field
 * (into whichever editor last had focus: body or email subject), block,
 * "Show if" condition and "Repeat for each" list.
 */

"use client";

import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Blocks, Braces, Eraser, Eye, Repeat, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CatalogField, CatalogList, TemplateData } from "@/lib/templates/catalog";
import type { BlockSource } from "@/lib/templates/render";
import type { TemplateKind } from "@/lib/templates/schema";
import { FieldPicker } from "./field-picker";
import { repeatListAt } from "./field-format-popover";
import { RuleForm } from "./rule-popover";
import type { ParagraphStyle } from "@/lib/templates/paragraph-styles";
import { ParagraphDialog } from "./paragraph-dialog";
import { StyleMenu } from "./style-menu";
import {
  AlignButtons,
  Divider,
  FontSizeField,
  ListButtons,
  MarkButtons,
  TableMenu,
  ToolButton,
} from "@/components/editor/controls";

export function Toolbar({
  editor,
  fieldTarget,
  kind,
  isBlock,
  fields,
  lists,
  data,
  blocks,
  styles,
}: {
  /** The body editor. */
  editor: Editor;
  /** Where "Insert field" goes: the body or the email subject. */
  fieldTarget: Editor;
  kind: TemplateKind;
  isBlock: boolean;
  fields: CatalogField[];
  lists: CatalogList[];
  data: TemplateData;
  /** Active blocks offered by "Insert block". */
  blocks: BlockSource[];
  /** The firm's paragraph styles (the Style menu's options). */
  styles: ParagraphStyle[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      repeatList: repeatListAt(e, e.state.selection.from),
    }),
  });
  const rich = kind !== "sms";
  const subjectTarget = fieldTarget !== editor;
  const chain = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-paper-2/40 px-1.5 py-1">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger
          render={
            <Button variant="outline" size="xs" className="gap-1">
              <Braces size={12} />
              Insert field{subjectTarget ? " in subject" : ""}
            </Button>
          }
        />
        <PopoverContent align="start" className="w-96">
          <FieldPicker
            fields={fields}
            lists={rich && !subjectTarget ? lists : []}
            repeatList={subjectTarget ? null : (s?.repeatList ?? null)}
            data={data}
            onPickField={(path) => {
              fieldTarget.chain().focus().insertField(path, null).run();
              setPickerOpen(false);
            }}
            onPickListField={
              rich && !subjectTarget
                ? (attrs) => {
                    chain().insertListField(attrs).run();
                    setPickerOpen(false);
                  }
                : undefined
            }
          />
        </PopoverContent>
      </Popover>

      {rich && <StyleMenu editor={editor} styles={styles} />}
      {rich && (
        <>
          {!isBlock && blocks.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="xs" className="gap-1">
                    <Blocks size={12} />
                    Insert block
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="min-w-48">
                {blocks.map((b) => (
                  <DropdownMenuItem key={b.id} onClick={() => chain().insertBlock(b.id).run()}>
                    {b.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Popover open={ruleOpen} onOpenChange={setRuleOpen}>
            <PopoverTrigger
              render={
                <Button variant="outline" size="xs" className="gap-1">
                  <Eye size={12} />
                  Show if…
                </Button>
              }
            />
            <PopoverContent align="start" className="w-80">
              <p className="text-2xs text-ink-4">Wraps the selected paragraphs in a condition.</p>
              <RuleForm
                fields={fields}
                submitLabel="Add condition"
                onSubmit={(attrs) => {
                  chain().wrapInShowIf(attrs).run();
                  setRuleOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          {lists.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="xs" className="gap-1">
                    <Repeat size={12} />
                    Repeat for each…
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="min-w-48">
                {lists.map((l) => (
                  <DropdownMenuItem key={l.path} onClick={() => chain().wrapInRepeat(l.path).run()}>
                    {l.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Divider />
          <MarkButtons
            editor={editor}
            marks={["bold", "italic", "underline", "smallCaps", "allCaps"]}
          />
          <FontSizeField editor={editor} />
          <ToolButton label="Clear formatting" onClick={() => chain().clearFormatting().run()}>
            <Eraser size={13} />
          </ToolButton>
          <ParagraphDialog editor={editor} styles={styles} />
          <Divider />
          <ListButtons editor={editor} />
          <AlignButtons editor={editor} />
          <TableMenu editor={editor} />
          {kind !== "email" && (
            <ToolButton label="Page break" onClick={() => chain().insertPageBreak().run()}>
              <Scissors size={13} />
            </ToolButton>
          )}
        </>
      )}
    </div>
  );
}
