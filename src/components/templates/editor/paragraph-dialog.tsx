/**
 * The toolbar's Paragraph… popover: direct settings for the selected
 * paragraphs. Each field shows the style's value as a placeholder until
 * changed; ↺ removes a direct setting; Apply writes only what changed.
 */

"use client";

import { useId, useState, type ReactNode } from "react";
import { type Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LINE_SPACINGS } from "@/lib/templates/style-basics";
import { styleValuesSchema, type ParagraphStyle } from "@/lib/templates/paragraph-styles";
import { resolveParagraph } from "@/lib/templates/resolve-styles";
import { selectedParagraphAttrs, type DirectKey } from "./paragraph-selection";

type Draft = Partial<Record<DirectKey, unknown>>;

const inputCls =
  "h-7 w-full min-w-0 rounded border border-line bg-white px-1.5 text-2xs text-ink placeholder:text-ink-4 aria-invalid:border-warn";

const ALIGN_LABEL = { left: "Left", center: "Center", right: "Right", justify: "Justified" };
const SPACING_LABEL: Record<string, string> = {
  single: "Single",
  "1.15": "1.15",
  "1.5": "1.5",
  double: "Double",
};
const spacingName = (v: unknown) =>
  typeof v === "string"
    ? (SPACING_LABEL[v] ?? v)
    : `Exactly ${String((v as { exactPt: number }).exactPt)} pt`;
const firstLineName = (v: { kind: string; in?: number }) =>
  v.kind === "none" ? "None" : `${v.kind === "indent" ? "Indent" : "Hanging"} ${String(v.in)} in`;
const yesNo = (b: unknown) => (b ? "Yes" : "No");

function Field({
  label,
  id,
  set,
  onReset,
  error,
  children,
}: {
  label: string;
  id: string;
  set: boolean;
  onReset: () => void;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-2xs text-ink-3">
          {label}
        </label>
        {set && (
          <button
            type="button"
            aria-label={`Reset ${label}`}
            title="Back to the style's value"
            onClick={onReset}
            className="text-2xs text-ink-4 hover:text-ink"
          >
            ↺
          </button>
        )}
      </div>
      <div className="flex gap-1">{children}</div>
      {error && <p className="text-2xs text-warn">{error}</p>}
    </div>
  );
}

function ParagraphForm({
  editor,
  styles,
  onDone,
}: {
  editor: Editor;
  styles: ParagraphStyle[];
  onDone: () => void;
}) {
  const uid = useId();
  const [current] = useState(() => selectedParagraphAttrs(editor)[0] ?? {});
  const [draft, setDraft] = useState<Draft>({});
  const base = resolveParagraph(
    typeof current.style === "string" ? current.style : undefined,
    {},
    styles,
  );

  const value = (k: DirectKey): unknown => (k in draft ? draft[k] : (current[k] ?? null));
  const put = (k: DirectKey, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const reset = (k: DirectKey) =>
    setDraft((d) => {
      const next = { ...d };
      if (current[k] === null || current[k] === undefined) delete next[k];
      else next[k] = null;
      return next;
    });

  const errors: Partial<Record<DirectKey, string>> = {};
  for (const [k, v] of Object.entries(draft) as [DirectKey, unknown][]) {
    if (v === null || k === "textAlign") continue;
    const parsed = styleValuesSchema.shape[k].safeParse(v);
    if (!parsed.success) errors[k] = parsed.error.issues[0]?.message ?? "Invalid value.";
  }
  const changed = Object.keys(draft).length > 0;
  const hasError = Object.keys(errors).length > 0;

  const num = (
    k: "spaceBeforePt" | "spaceAfterPt" | "indentLeftIn" | "indentRightIn",
    label: string,
    unit: string,
  ) => {
    const v = value(k);
    const id = `${uid}-${k}`;
    return (
      <Field
        label={`${label} (${unit})`}
        id={id}
        set={v !== null}
        onReset={() => reset(k)}
        error={errors[k]}
      >
        <input
          id={id}
          type="number"
          step={unit === "pt" ? 1 : 0.05}
          className={inputCls}
          aria-invalid={errors[k] ? true : undefined}
          placeholder={String(base[k])}
          value={typeof v === "number" ? v : ""}
          onChange={(e) => put(k, e.target.value === "" ? null : Number(e.target.value))}
        />
      </Field>
    );
  };

  const flag = (k: "keepWithNext" | "keepLinesTogether" | "pageBreakBefore", label: string) => {
    const v = value(k);
    const id = `${uid}-${k}`;
    return (
      <Field label={label} id={id} set={v !== null} onReset={() => reset(k)}>
        <NativeSelect
          size="sm"
          id={id}
          className="min-w-0 flex-1"
          value={v === null ? "" : v ? "yes" : "no"}
          onChange={(e) => put(k, e.target.value === "" ? null : e.target.value === "yes")}
        >
          <NativeSelectOption value="">(style) {yesNo(base[k])}</NativeSelectOption>
          <NativeSelectOption value="yes">Yes</NativeSelectOption>
          <NativeSelectOption value="no">No</NativeSelectOption>
        </NativeSelect>
      </Field>
    );
  };

  const ls = value("lineSpacing");
  const lsKind = ls === null ? "" : typeof ls === "string" ? ls : "exact";
  const fl = value("firstLine") as { kind: string; in?: number } | null;

  return (
    <form
      className="flex flex-col gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed || hasError) return;
        editor
          .chain()
          .focus()
          .setParagraphSettings(draft as Parameters<Editor["commands"]["setParagraphSettings"]>[0])
          .run();
        onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        {num("spaceBeforePt", "Space before", "pt")}
        {num("spaceAfterPt", "Space after", "pt")}
        {num("indentLeftIn", "Left indent", "in")}
        {num("indentRightIn", "Right indent", "in")}
      </div>

      <Field
        label="Line spacing"
        id={`${uid}-ls`}
        set={ls !== null}
        onReset={() => reset("lineSpacing")}
        error={errors.lineSpacing}
      >
        <NativeSelect
          size="sm"
          id={`${uid}-ls`}
          className="min-w-0 flex-1"
          value={lsKind}
          onChange={(e) => {
            const v = e.target.value;
            put("lineSpacing", v === "" ? null : v === "exact" ? { exactPt: 12 } : v);
          }}
        >
          <NativeSelectOption value="">(style) {spacingName(base.lineSpacing)}</NativeSelectOption>
          {LINE_SPACINGS.map((o) => (
            <NativeSelectOption key={o} value={o}>
              {SPACING_LABEL[o]}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="exact">Exactly…</NativeSelectOption>
        </NativeSelect>
        {lsKind === "exact" && (
          <input
            type="number"
            aria-label="Exact line spacing (pt)"
            className={inputCls}
            value={(ls as { exactPt: number }).exactPt}
            onChange={(e) => put("lineSpacing", { exactPt: Number(e.target.value) })}
          />
        )}
      </Field>

      <Field
        label="First line"
        id={`${uid}-fl`}
        set={fl !== null}
        onReset={() => reset("firstLine")}
        error={errors.firstLine}
      >
        <NativeSelect
          size="sm"
          id={`${uid}-fl`}
          className="min-w-0 flex-1"
          value={fl?.kind ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            put(
              "firstLine",
              v === "" ? null : v === "none" ? { kind: "none" } : { kind: v, in: 0.5 },
            );
          }}
        >
          <NativeSelectOption value="">(style) {firstLineName(base.firstLine)}</NativeSelectOption>
          <NativeSelectOption value="none">None</NativeSelectOption>
          <NativeSelectOption value="indent">Indent</NativeSelectOption>
          <NativeSelectOption value="hanging">Hanging</NativeSelectOption>
        </NativeSelect>
        {fl && fl.kind !== "none" && (
          <input
            type="number"
            step={0.05}
            aria-label="First line amount (in)"
            className={inputCls}
            value={fl.in}
            onChange={(e) => put("firstLine", { kind: fl.kind, in: Number(e.target.value) })}
          />
        )}
      </Field>

      <Field
        label="Alignment"
        id={`${uid}-align`}
        set={value("textAlign") !== null}
        onReset={() => reset("textAlign")}
      >
        <NativeSelect
          size="sm"
          id={`${uid}-align`}
          className="min-w-0 flex-1"
          value={(value("textAlign") as string | null) ?? ""}
          onChange={(e) => put("textAlign", e.target.value === "" ? null : e.target.value)}
        >
          <NativeSelectOption value="">(style) {ALIGN_LABEL[base.align]}</NativeSelectOption>
          {Object.entries(ALIGN_LABEL).map(([v, l]) => (
            <NativeSelectOption key={v} value={v}>
              {l}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <div className="grid grid-cols-3 gap-2">
        {flag("keepWithNext", "Keep with next")}
        {flag("keepLinesTogether", "Keep lines together")}
        {flag("pageBreakBefore", "Page break before")}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="xs" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={!changed || hasError}>
          Apply
        </Button>
      </div>
    </form>
  );
}

export function ParagraphDialog({ editor, styles }: { editor: Editor; styles: ParagraphStyle[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="xs" onMouseDown={(e) => e.preventDefault()}>
            Paragraph…
          </Button>
        }
      />
      <PopoverContent align="start" className="w-96">
        {/* Mounted only while open, so it reads the selection fresh each time. */}
        <ParagraphForm editor={editor} styles={styles} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
