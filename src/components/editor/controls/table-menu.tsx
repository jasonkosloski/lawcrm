/**
 * The toolbar's table controls: insert a table, then (with the cursor in
 * one) rows, columns, merging, width, borders and
 * vertical alignment. Always shown, greyed out outside a table, so they
 * can be found. Horizontal alignment is the toolbar's own align
 * buttons, which apply to every selected cell.
 */

"use client";

import { useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ChevronDown,
  Grid2x2,
  Table,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CellSide, VerticalAlign } from "@/lib/templates/schema";
import {
  bordersAre,
  mergeCheck,
  setBorders,
  setTableWidth,
  tableWidthAt,
  type BorderTarget,
  type MergeCheck,
  type TableWidth,
  type Weight,
} from "@/components/templates/editor/table-commands";
import { ToolButton } from "./tool-button";

const SIDES: CellSide[] = ["top", "bottom", "left", "right"];
const SIDE_LABEL: Record<CellSide, string> = {
  top: "Top border",
  bottom: "Bottom border",
  left: "Left border",
  right: "Right border",
};
const PRESETS: { target: BorderTarget; label: string }[] = [
  { target: "all", label: "All borders" },
  { target: "outer", label: "Outside borders" },
  { target: "inner", label: "Inside borders" },
  { target: "none", label: "No borders" },
];

/** A 2x2 cell diagram with the lines `target` draws in solid ink. */
function BorderIcon({ target }: { target: BorderTarget }) {
  const on = (edge: CellSide | "innerH" | "innerV") => {
    if (target === "all") return true;
    if (target === "none") return false;
    if (target === "outer") return edge !== "innerH" && edge !== "innerV";
    if (target === "inner") return edge === "innerH" || edge === "innerV";
    return edge === target;
  };
  const line = (edge: Parameters<typeof on>[0], d: string) => (
    <path
      d={d}
      stroke="currentColor"
      strokeWidth={on(edge) ? 1.6 : 1}
      strokeDasharray={on(edge) ? undefined : "1.5 1.5"}
      opacity={on(edge) ? 1 : 0.45}
    />
  );
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      {line("top", "M1 1H13")}
      {line("bottom", "M1 13H13")}
      {line("left", "M1 1V13")}
      {line("right", "M13 1V13")}
      {line("innerH", "M1 7H13")}
      {line("innerV", "M7 1V13")}
    </svg>
  );
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex-1 rounded px-2 py-0.5 text-2xs text-ink-3 hover:text-ink",
        active && "bg-paper text-ink shadow-sm",
      )}
    >
      {children}
    </button>
  );
}

const NO_SIDES = { top: false, bottom: false, left: false, right: false };
const OUTSIDE = {
  inTable: false,
  width: "full" as TableWidth,
  merge: "unavailable" as MergeCheck,
  canSplit: false,
  middle: false,
  bottom: false,
  thin: NO_SIDES as Record<CellSide, boolean>,
  thick: NO_SIDES as Record<CellSide, boolean>,
};

export type TableFeatures = {
  merge?: boolean;
  borders?: boolean;
  width?: boolean;
  valign?: boolean;
};

/** Every feature is on unless a caller turns it off. */
export function TableMenu({ editor, features }: { editor: Editor; features?: TableFeatures }) {
  const {
    merge = true,
    borders = true,
    width: showWidth = true,
    valign: showValign = true,
  } = features ?? {};
  const [weight, setWeight] = useState<Weight>("thin");
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const width = tableWidthAt(e.state);
      if (!width) return OUTSIDE;
      const va = (v: VerticalAlign) =>
        e.isActive("tableCell", { verticalAlign: v }) ||
        e.isActive("tableHeader", { verticalAlign: v });
      return {
        inTable: true,
        width,
        merge: mergeCheck(e.state),
        canSplit: e.can().splitCell(),
        middle: va("middle"),
        bottom: va("bottom"),
        thin: Object.fromEntries(SIDES.map((x) => [x, bordersAre(e.state, x, "thin")])),
        thick: Object.fromEntries(SIDES.map((x) => [x, bordersAre(e.state, x, "thick")])),
      };
    },
  });
  const t = s ?? OUTSIDE;
  const off = !t.inTable;

  const chain = () => editor.chain().focus();
  const dispatch = (tr: ReturnType<typeof setBorders>) => {
    if (tr) editor.view.dispatch(tr);
    editor.commands.focus();
  };
  const width = (w: TableWidth) => dispatch(setTableWidth(editor.state, w));
  const valign = (v: VerticalAlign) =>
    chain()
      .setCellAttribute("verticalAlign", v === "top" ? null : v)
      .run();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="xs" className="gap-1">
              <Table size={12} />
              Table
              <ChevronDown size={11} />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuItem
            onClick={() => chain().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()}
          >
            Insert table
          </DropdownMenuItem>
          {off && (
            <p className="px-1.5 py-1 text-2xs text-ink-4">
              Click in a table for rows, columns, merging and width.
            </p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={off} onClick={() => chain().addRowBefore().run()}>
            Insert row above
          </DropdownMenuItem>
          <DropdownMenuItem disabled={off} onClick={() => chain().addRowAfter().run()}>
            Insert row below
          </DropdownMenuItem>
          <DropdownMenuItem disabled={off} onClick={() => chain().addColumnBefore().run()}>
            Insert column left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={off} onClick={() => chain().addColumnAfter().run()}>
            Insert column right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={off} onClick={() => chain().deleteRow().run()}>
            Delete row
          </DropdownMenuItem>
          <DropdownMenuItem disabled={off} onClick={() => chain().deleteColumn().run()}>
            Delete column
          </DropdownMenuItem>
          {merge && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={t.merge !== "ok"}
                onClick={() => chain().mergeCells().run()}
              >
                Merge cells
              </DropdownMenuItem>
              {t.merge === "interlock" && (
                <p className="max-w-52 px-1.5 py-1 text-2xs text-ink-4">
                  These cells would interlock with other merged cells in a way the PDF can&apos;t
                  draw. Split one of them first.
                </p>
              )}
              <DropdownMenuItem disabled={!t.canSplit} onClick={() => chain().splitCell().run()}>
                Split cell
              </DropdownMenuItem>
            </>
          )}
          {showWidth && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                disabled={off}
                checked={t.inTable && t.width === "full"}
                onClick={() => width("full")}
              >
                Full width
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                disabled={off}
                checked={t.width === "fit"}
                onClick={() => width("fit")}
              >
                Fit to content
              </DropdownMenuCheckboxItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={off}
            onClick={() => chain().deleteTable().run()}
          >
            Delete table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {borders && (
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="xs" className="gap-1" disabled={off}>
                <Grid2x2 size={12} />
                Borders
                <ChevronDown size={11} />
              </Button>
            }
          />
          <PopoverContent align="start" className="w-56">
            <div className="flex gap-0.5 rounded bg-paper-2 p-0.5" role="group" aria-label="Line">
              <Segment active={weight === "thin"} onClick={() => setWeight("thin")}>
                Thin
              </Segment>
              <Segment active={weight === "thick"} onClick={() => setWeight("thick")}>
                Thick
              </Segment>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {PRESETS.map((p) => (
                <ToolButton
                  key={p.target}
                  label={p.label}
                  onClick={() => dispatch(setBorders(editor.state, p.target, weight))}
                >
                  <BorderIcon target={p.target} />
                </ToolButton>
              ))}
              {SIDES.map((side) => (
                <ToolButton
                  key={side}
                  label={SIDE_LABEL[side]}
                  active={t[weight][side]}
                  onClick={() => dispatch(setBorders(editor.state, side, weight))}
                >
                  <BorderIcon target={side} />
                </ToolButton>
              ))}
            </div>
            <p className="mt-2 text-2xs text-ink-4">
              Applies to the selected cells. A side button turns that line on or off.
            </p>
          </PopoverContent>
        </Popover>
      )}

      {showValign && (
        <>
          <ToolButton
            label="Align top"
            disabled={off}
            active={t.inTable && !t.middle && !t.bottom}
            onClick={() => valign("top")}
          >
            <AlignVerticalJustifyStart size={13} />
          </ToolButton>
          <ToolButton
            label="Align middle"
            disabled={off}
            active={t.middle}
            onClick={() => valign("middle")}
          >
            <AlignVerticalJustifyCenter size={13} />
          </ToolButton>
          <ToolButton
            label="Align bottom"
            disabled={off}
            active={t.bottom}
            onClick={() => valign("bottom")}
          >
            <AlignVerticalJustifyEnd size={13} />
          </ToolButton>
        </>
      )}
    </>
  );
}
