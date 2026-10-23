/**
 * The toolbar's Style dropdown: names the current paragraph's style (Body
 * when none), previews each option in its own look and sets the style on
 * every selected paragraph. A dot marks paragraphs with direct settings.
 */

"use client";

import { ChevronDown } from "lucide-react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ParagraphStyle } from "@/lib/templates/paragraph-styles";
import { hasDirectSettings, selectedParagraphAttrs } from "./paragraph-selection";

/** Largest size an option previews at, so a Title doesn't swamp the menu. */
const PREVIEW_MAX_PX = 18;

function lookOf(s: ParagraphStyle) {
  const v = s.values;
  return {
    fontSize: `${String(Math.min(v.sizePt, PREVIEW_MAX_PX))}px`,
    fontWeight: v.bold ? "bold" : "normal",
    fontStyle: v.italic ? "italic" : "normal",
    textTransform: v.allCaps ? ("uppercase" as const) : ("none" as const),
    fontVariant: v.smallCaps ? "small-caps" : "normal",
    textDecoration: v.underline ? "underline" : "none",
  };
}

export function StyleMenu({ editor, styles }: { editor: Editor; styles: ParagraphStyle[] }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const attrs = selectedParagraphAttrs(e);
      const keys = new Set(attrs.map((a) => (typeof a.style === "string" ? a.style : "body")));
      return {
        // One shared key, or null for a mixed selection.
        key: keys.size === 1 ? [...keys][0] : null,
        direct: hasDirectSettings(attrs),
      };
    },
  });
  const ordered = [...styles.filter((x) => x.builtIn), ...styles.filter((x) => !x.builtIn)];
  const current = s?.key ? styles.find((x) => x.key === s.key) : undefined;
  const label = !s?.key ? "Mixed" : current ? current.name : `${s.key} (missing)`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="min-w-24 justify-between gap-1"
            aria-label={`Style: ${label}`}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span className="truncate">{label}</span>
            {s?.direct && (
              <span
                role="img"
                aria-label="Has direct formatting"
                className="size-1.5 shrink-0 rounded-full bg-accent"
              />
            )}
            <ChevronDown size={12} aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-80 min-w-48 overflow-y-auto">
        {ordered.map((st) => (
          <DropdownMenuItem
            key={st.key}
            onClick={() => editor.chain().focus().setParagraphStyle(st.key).run()}
          >
            <span style={lookOf(st)}>{st.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
