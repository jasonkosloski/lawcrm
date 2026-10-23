/**
 * Column width in inches: a toolbar popover that sets the selected
 * columns (or the cursor's) to a typed width. A full-width table's other
 * columns share the rest of the text width (see setColumnWidth).
 */

"use client";

import { useState, type FormEvent } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, MoveHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { columnWidthAt, MIN_COLUMN_IN, setColumnWidth, type TableWidth } from "../table-commands";

/** `table`: the cursor's table width (null outside a table), from
 *  TableMenu's own editor state. */
export function ColumnWidth({
  editor,
  table,
  textWidthIn,
}: {
  editor: Editor;
  table: TableWidth | null;
  textWidthIn: number;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onOpenChange = (next: boolean) => {
    if (next) {
      const inches = columnWidthAt(editor.state, textWidthIn);
      setValue(inches === null ? "" : String(inches));
      setError(null);
    }
    setOpen(next);
  };

  const measure = (pos: number) => {
    const el = editor.view.nodeDOM(pos);
    return el instanceof HTMLElement ? el.getBoundingClientRect().width : null;
  };

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const r = setColumnWidth(editor.state, Number(value), textWidthIn, measure);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    editor.view.dispatch(r);
    editor.commands.focus();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="xs" className="gap-1" disabled={!table}>
            <MoveHorizontal size={12} />
            Width
            <ChevronDown size={11} />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-64">
        <form onSubmit={apply} noValidate className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-xs text-ink-2">
            Column width
            <Input
              type="number"
              inputMode="decimal"
              min={MIN_COLUMN_IN}
              max={textWidthIn}
              step="any"
              value={value}
              placeholder="Auto"
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              className="h-7 w-20"
              autoFocus
            />
            in
          </label>
          {error && <div className="text-2xs text-warn">{error}</div>}
          <p className="text-2xs text-ink-4">
            {table === "fit"
              ? "Sets the selected columns exactly; the others keep the width they have now."
              : `A full-width table fills the text width (${textWidthIn} in), so the other columns share what's left.`}
          </p>
          <div className="flex justify-end">
            <Button type="submit" size="xs" disabled={!value.trim()}>
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
