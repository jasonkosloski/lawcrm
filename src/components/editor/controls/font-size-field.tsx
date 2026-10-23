/** The toolbar's size box: a run's own size in points; empty removes it. */

"use client";

import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { styleValuesSchema } from "@/lib/templates/paragraph-styles";

const COMMON_SIZES = [10, 11, 12, 14, 16, 18, 24];

export function FontSizeField({ editor }: { editor: Editor }) {
  const pt = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.getAttributes("fontSize").pt as number | undefined) ?? null,
  });
  // The text being typed; null shows the selection's size.
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (text === null) return;
    const trimmed = text.trim();
    if (trimmed === "") {
      editor.chain().focus().setFontSize(null).run();
    } else {
      const n = Number(trimmed);
      if (!styleValuesSchema.shape.sizePt.safeParse(n).success) {
        setInvalid(true);
        return;
      }
      editor.chain().focus().setFontSize(n).run();
    }
    setInvalid(false);
    setText(null);
  };

  return (
    <>
      <input
        type="number"
        aria-label="Font size"
        title="Font size (pt); empty uses the style's size"
        list="template-font-sizes"
        min={8}
        max={72}
        step={0.5}
        placeholder="Size"
        aria-invalid={invalid || undefined}
        value={text ?? (pt === null ? "" : String(pt))}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="h-7 w-14 rounded border border-line bg-white px-1.5 text-2xs text-ink aria-invalid:border-warn"
      />
      <datalist id="template-font-sizes">
        {COMMON_SIZES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}
