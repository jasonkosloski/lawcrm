/**
 * Paragraph styles form — Settings -> Documents -> Styles.
 *
 * The firm's named paragraph styles: the list on the left (built-ins, then
 * custom), the selected style's values on the right with a live sample
 * paragraph in the house font. Everything is edited locally and saved as one
 * list with the house style's stale check (`expectedUpdatedAt`). Built-ins
 * can be edited but not renamed or deleted; Add copies the selected style.
 * The server refuses deleting a style that templates still use and says
 * which. Without `firm.edit_document_style` every control is disabled.
 */

"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { saveParagraphStyles } from "@/app/actions/document-style";
import { Button } from "@/components/ui/button";
import { Field, FormErrorBanner, inputClass } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { FONT_KEYS, LINE_SPACINGS, type FontKey } from "@/lib/templates/page-style";
import {
  newStyleKey,
  type FirstLine,
  type LineSpacingValue,
  type ParagraphStyle,
  type StyleValues,
} from "@/lib/templates/paragraph-styles";
import { pageFontFaceCss, previewFontFamily } from "@/lib/templates/to-html";

const ALL_FONT_FACES = FONT_KEYS.map(pageFontFaceCss).join("\n");
const STALE_PREFIX = "Someone else saved";
const SAMPLE =
  "The parties agree that the matter will proceed as described below. This sample line shows how a paragraph in this style is set on the page, including its spacing, indents and alignment.";

const LINE_LABEL = { single: "Single", "1.15": "1.15", "1.5": "1.5", double: "Double" } as const;
const ALIGN_LABEL = { left: "Left", center: "Center", right: "Right", justify: "Justify" } as const;
const FIRST_LINE_LABEL = { none: "None", indent: "Indent", hanging: "Hanging" } as const;
const TOGGLES = [
  ["bold", "Bold"],
  ["italic", "Italic"],
  ["underline", "Underline"],
  ["smallCaps", "Small caps"],
  ["allCaps", "All caps"],
] as const;
const FLOW = [
  ["keepWithNext", "Keep with next"],
  ["keepLinesTogether", "Keep lines together"],
  ["pageBreakBefore", "Page break before"],
] as const;

type Props = {
  initial: ParagraphStyle[];
  /** ISO timestamp of the loaded row (the optimistic-lock token). */
  updatedAt: string;
  fontKey: FontKey;
  canEdit: boolean;
};

/** The sample paragraph's CSS for a style's values, in the page font. */
function sampleCss(v: StyleValues, fontKey: FontKey): CSSProperties {
  const multiple = typeof v.lineSpacing === "string" ? LINE_FACTOR[v.lineSpacing] : null;
  const first = v.firstLine;
  return {
    fontFamily: `"${previewFontFamily(fontKey)}", serif`,
    fontSize: `${v.sizePt}pt`,
    fontWeight: v.bold ? "bold" : "normal",
    fontStyle: v.italic ? "italic" : "normal",
    textDecoration: v.underline ? "underline" : "none",
    fontVariantCaps: v.smallCaps ? "small-caps" : "normal",
    textTransform: v.allCaps ? "uppercase" : "none",
    textAlign: v.align,
    lineHeight:
      multiple !== null
        ? String(multiple * 1.15)
        : `${(v.lineSpacing as { exactPt: number }).exactPt}pt`,
    marginTop: `${v.spaceBeforePt}pt`,
    marginBottom: `${v.spaceAfterPt}pt`,
    marginLeft: `${v.indentLeftIn}in`,
    marginRight: `${v.indentRightIn}in`,
    ...(first.kind === "indent" ? { textIndent: `${first.in}in` } : {}),
    ...(first.kind === "hanging"
      ? { paddingLeft: `${first.in}in`, textIndent: `-${first.in}in` }
      : {}),
  };
}
const LINE_FACTOR = { single: 1, "1.15": 1.15, "1.5": 1.5, double: 2 } as const;

export function ParagraphStylesForm({
  initial,
  updatedAt: initialUpdatedAt,
  fontKey,
  canEdit,
}: Props) {
  const [styles, setStyles] = useState<ParagraphStyle[]>(initial);
  const [selectedKey, setSelectedKey] = useState(initial[0]?.key ?? "body");
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = styles.find((s) => s.key === selectedKey) ?? styles[0];
  const dis = !canEdit;
  const ctl = (extra = "") => `${inputClass(false, "md")} ${extra}`;
  const ordered = [...styles.filter((s) => s.builtIn), ...styles.filter((s) => !s.builtIn)];

  const update = (fn: (s: ParagraphStyle) => ParagraphStyle) => {
    setStyles((list) => list.map((s) => (s.key === selected.key ? fn(s) : s)));
    setSaved(false);
  };
  const setValue = <K extends keyof StyleValues>(key: K, value: StyleValues[K]) =>
    update((s) => ({ ...s, values: { ...s.values, [key]: value } }));
  /** Number box: an empty box is mid-edit, so hold the last good number. */
  const num = (apply: (n: number) => void) => (raw: string) => {
    if (raw.trim() === "") return;
    const n = Number(raw);
    if (Number.isFinite(n)) apply(n);
  };

  const add = () => {
    let name = `${selected.name} copy`;
    const lower = new Set(styles.map((s) => s.name.toLowerCase()));
    for (let n = 2; lower.has(name.toLowerCase()); n++) name = `${selected.name} copy ${n}`;
    const key = newStyleKey(name, new Set(styles.map((s) => s.key)));
    setStyles((list) => [
      ...list,
      { key, name, builtIn: false, values: structuredClone(selected.values) },
    ]);
    setSelectedKey(key);
    setSaved(false);
    setError(null);
  };
  const remove = () => {
    if (selected.builtIn) return;
    setStyles((list) => list.filter((s) => s.key !== selected.key));
    setSelectedKey("body");
    setSaved(false);
    setError(null);
  };

  const save = () => {
    setError(null);
    setStale(false);
    setSaved(false);
    startTransition(async () => {
      const res = await saveParagraphStyles({ styles, expectedUpdatedAt: updatedAt });
      if (res.ok) {
        setUpdatedAt(res.updatedAt);
        setSaved(true);
      } else {
        setError(res.error);
        setStale(res.error.startsWith(STALE_PREFIX));
      }
    });
  };

  const v = selected.values;
  const exactPt = typeof v.lineSpacing === "object" ? v.lineSpacing.exactPt : null;
  const setLine = (raw: string) => {
    const next: LineSpacingValue =
      raw === "exact" ? { exactPt: 14 } : (raw as (typeof LINE_SPACINGS)[number]);
    setValue("lineSpacing", next);
  };
  const setFirstKind = (kind: string) => {
    const next: FirstLine =
      kind === "none" ? { kind: "none" } : { kind: kind as "indent" | "hanging", in: 0.5 };
    setValue("firstLine", next);
  };

  return (
    <section aria-labelledby="paragraph-styles-heading" className="mt-10">
      <style>{ALL_FONT_FACES}</style>
      <h2 id="paragraph-styles-heading" className="text-sm font-semibold text-ink">
        Styles
      </h2>
      <p className="mt-1 mb-4 text-xs text-ink-3">
        Named paragraph styles for templates. Body is the default text of every document.
        {!canEdit && " You can view the styles but not change them."}
      </p>
      <form
        noValidate
        className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (canEdit) save();
        }}
      >
        <div className="flex flex-col gap-2">
          <ul aria-label="Styles" className="flex flex-col gap-0.5">
            {ordered.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  aria-current={s.key === selected.key ? "true" : undefined}
                  onClick={() => setSelectedKey(s.key)}
                  className={cn(
                    "w-full rounded-md px-2.5 py-1.5 text-left text-xs",
                    s.key === selected.key
                      ? "bg-brand-500/10 font-medium text-ink"
                      : "text-ink-2 hover:bg-black/5",
                  )}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
          {canEdit && (
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <Plus size={12} />
              Add style
            </Button>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Style name" className="col-span-2 sm:col-span-3">
              {(c) => (
                <input
                  {...c}
                  value={selected.name}
                  disabled={dis || selected.builtIn}
                  maxLength={60}
                  onChange={(e) => update((s) => ({ ...s, name: e.target.value }))}
                  className={ctl()}
                />
              )}
            </Field>
            <Field label="Size (pt)">
              {(c) => (
                <input
                  {...c}
                  type="number"
                  min={8}
                  max={72}
                  step={0.5}
                  value={v.sizePt}
                  disabled={dis}
                  onChange={(e) => num((n) => setValue("sizePt", n))(e.target.value)}
                  className={ctl()}
                />
              )}
            </Field>
            <Field label="Alignment">
              {(c) => (
                <NativeSelect
                  {...c}
                  value={v.align}
                  disabled={dis}
                  onChange={(e) => setValue("align", e.target.value as StyleValues["align"])}
                  className="w-full"
                >
                  {(Object.keys(ALIGN_LABEL) as (keyof typeof ALIGN_LABEL)[]).map((a) => (
                    <option key={a} value={a}>
                      {ALIGN_LABEL[a]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>

          <fieldset className="flex flex-wrap gap-x-4 gap-y-1" disabled={dis}>
            <legend className="mb-1 text-xs font-medium text-ink-2">Text</legend>
            {TOGGLES.map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={v[key]}
                  disabled={dis}
                  onChange={(e) => setValue(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Left indent (in)">
              {(c) => (
                <input
                  {...c}
                  type="number"
                  min={0}
                  max={4}
                  step={0.05}
                  value={v.indentLeftIn}
                  disabled={dis}
                  onChange={(e) => num((n) => setValue("indentLeftIn", n))(e.target.value)}
                  className={ctl()}
                />
              )}
            </Field>
            <Field label="Right indent (in)">
              {(c) => (
                <input
                  {...c}
                  type="number"
                  min={0}
                  max={4}
                  step={0.05}
                  value={v.indentRightIn}
                  disabled={dis}
                  onChange={(e) => num((n) => setValue("indentRightIn", n))(e.target.value)}
                  className={ctl()}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="First line">
                {(c) => (
                  <NativeSelect
                    {...c}
                    value={v.firstLine.kind}
                    disabled={dis}
                    onChange={(e) => setFirstKind(e.target.value)}
                    className="w-full"
                  >
                    {(Object.keys(FIRST_LINE_LABEL) as (keyof typeof FIRST_LINE_LABEL)[]).map(
                      (k) => (
                        <option key={k} value={k}>
                          {FIRST_LINE_LABEL[k]}
                        </option>
                      ),
                    )}
                  </NativeSelect>
                )}
              </Field>
              {v.firstLine.kind !== "none" && (
                <Field label="First line (in)">
                  {(c) => (
                    <input
                      {...c}
                      type="number"
                      min={0}
                      max={4}
                      step={0.05}
                      value={v.firstLine.kind === "none" ? 0 : v.firstLine.in}
                      disabled={dis}
                      onChange={(e) =>
                        num((n) =>
                          setValue("firstLine", {
                            kind: (v.firstLine as { kind: "indent" | "hanging" }).kind,
                            in: n,
                          }),
                        )(e.target.value)
                      }
                      className={ctl()}
                    />
                  )}
                </Field>
              )}
            </div>
            <Field label="Space before (pt)">
              {(c) => (
                <input
                  {...c}
                  type="number"
                  min={0}
                  max={72}
                  step={1}
                  value={v.spaceBeforePt}
                  disabled={dis}
                  onChange={(e) => num((n) => setValue("spaceBeforePt", n))(e.target.value)}
                  className={ctl()}
                />
              )}
            </Field>
            <Field label="Space after (pt)">
              {(c) => (
                <input
                  {...c}
                  type="number"
                  min={0}
                  max={72}
                  step={1}
                  value={v.spaceAfterPt}
                  disabled={dis}
                  onChange={(e) => num((n) => setValue("spaceAfterPt", n))(e.target.value)}
                  className={ctl()}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Line spacing">
                {(c) => (
                  <NativeSelect
                    {...c}
                    value={typeof v.lineSpacing === "string" ? v.lineSpacing : "exact"}
                    disabled={dis}
                    onChange={(e) => setLine(e.target.value)}
                    className="w-full"
                  >
                    {LINE_SPACINGS.map((l) => (
                      <option key={l} value={l}>
                        {LINE_LABEL[l]}
                      </option>
                    ))}
                    <option value="exact">Exactly</option>
                  </NativeSelect>
                )}
              </Field>
              {exactPt !== null && (
                <Field label="Exact spacing (pt)">
                  {(c) => (
                    <input
                      {...c}
                      type="number"
                      min={6}
                      max={144}
                      step={0.5}
                      value={exactPt}
                      disabled={dis}
                      onChange={(e) =>
                        num((n) => setValue("lineSpacing", { exactPt: n }))(e.target.value)
                      }
                      className={ctl()}
                    />
                  )}
                </Field>
              )}
            </div>
          </div>

          <fieldset className="flex flex-wrap gap-x-4 gap-y-1" disabled={dis}>
            <legend className="mb-1 text-xs font-medium text-ink-2">Flow</legend>
            {FLOW.map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={v[key]}
                  disabled={dis}
                  onChange={(e) => setValue(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>

          <div>
            <p className="mb-1 text-xs font-medium text-ink-2">Sample</p>
            <div
              className="overflow-hidden rounded-md border border-line bg-white p-6 text-black"
              aria-label="Sample paragraph"
            >
              <p data-testid="style-sample" style={sampleCss(v, fontKey)}>
                {SAMPLE}
              </p>
            </div>
          </div>

          <FormErrorBanner message={error} />
          {stale && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            </div>
          )}
          {canEdit && (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save styles"}
              </Button>
              {!selected.builtIn && (
                <Button type="button" variant="outline" onClick={remove}>
                  <Trash2 size={12} />
                  Delete style
                </Button>
              )}
              {saved && (
                <span className="inline-flex items-center gap-1 text-2xs text-ink-3" role="status">
                  <CheckCircle2 size={12} />
                  Saved
                </span>
              )}
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
