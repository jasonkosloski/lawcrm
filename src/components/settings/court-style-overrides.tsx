/**
 * Court format Styles section — per-style overrides of individual values.
 *
 * Pick one of the firm's styles (built-ins first, then custom); every field
 * starts unset and shows the firm's value as its placeholder. Setting a
 * field overrides it for filings in this court; the field's reset button
 * removes the override. A style with nothing set contributes nothing.
 */

"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Field } from "@/components/ui/field";
import { inputClass } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { LINE_SPACINGS } from "@/lib/templates/page-style";
import type { FirstLine, ParagraphStyle, StyleValues } from "@/lib/templates/paragraph-styles";

export type StyleOverrides = Record<string, Partial<StyleValues>>;

const LINE_LABEL = { single: "Single", "1.15": "1.15", "1.5": "1.5", double: "Double" } as const;
const ALIGN_LABEL = { left: "Left", center: "Center", right: "Right", justify: "Justify" } as const;
const FIRST_LABEL = { none: "None", indent: "Indent", hanging: "Hanging" } as const;
const TOGGLES = [
  ["bold", "Bold"],
  ["italic", "Italic"],
  ["underline", "Underline"],
  ["smallCaps", "Small caps"],
  ["allCaps", "All caps"],
  ["keepWithNext", "Keep with next"],
  ["keepLinesTogether", "Keep lines together"],
  ["pageBreakBefore", "Page break before"],
] as const;
const NUMBERS = [
  ["sizePt", "Size (pt)", 0.5],
  ["indentLeftIn", "Left indent (in)", 0.05],
  ["indentRightIn", "Right indent (in)", 0.05],
  ["spaceBeforePt", "Space before (pt)", 1],
  ["spaceAfterPt", "Space after (pt)", 1],
] as const;

const lineKey = (l: StyleValues["lineSpacing"]) => (typeof l === "string" ? l : "exact");
const lineText = (l: StyleValues["lineSpacing"]) =>
  typeof l === "string" ? LINE_LABEL[l] : `Exactly ${l.exactPt} pt`;
const firstText = (f: FirstLine) =>
  f.kind === "none" ? "None" : `${FIRST_LABEL[f.kind]} ${f.in} in`;

export function CourtStyleOverrides({
  styles,
  overrides,
  onChange,
  disabled,
}: {
  styles: ParagraphStyle[];
  overrides: StyleOverrides;
  onChange: (next: StyleOverrides) => void;
  disabled: boolean;
}) {
  const ordered = [...styles.filter((s) => s.builtIn), ...styles.filter((s) => !s.builtIn)];
  const [key, setKey] = useState(ordered[0]?.key ?? "body");
  const style = ordered.find((s) => s.key === key) ?? ordered[0];
  if (!style) return null;
  const firm = style.values;
  const cur = overrides[style.key] ?? {};
  const ctl = `${inputClass(false, "md")}`;

  const put = <K extends keyof StyleValues>(field: K, value: StyleValues[K] | undefined) => {
    const next = { ...cur };
    if (value === undefined) delete next[field];
    else next[field] = value;
    const all = { ...overrides };
    if (Object.keys(next).length === 0) delete all[style.key];
    else all[style.key] = next;
    onChange(all);
  };
  const reset = (field: keyof StyleValues, label: string) =>
    field in cur && !disabled ? (
      <button
        type="button"
        aria-label={`Reset ${label}`}
        onClick={() => put(field, undefined)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-brand-soft hover:text-brand-700"
      >
        <RotateCcw size={12} />
      </button>
    ) : null;
  const num = (raw: string): number | undefined => {
    if (raw.trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const changed = (s: ParagraphStyle) => Object.keys(overrides[s.key] ?? {}).length;

  const lineSel = cur.lineSpacing === undefined ? "" : lineKey(cur.lineSpacing);
  const first = cur.firstLine;

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="mb-1 text-xs font-medium text-ink-2">Styles</legend>
      <p className="text-2xs text-ink-4">
        Set only what this court changes. Unset fields follow the firm&apos;s style.
      </p>
      <Field label="Style">
        {(c) => (
          <NativeSelect
            {...c}
            value={style.key}
            onChange={(e) => setKey(e.target.value)}
            className="w-full"
          >
            {ordered.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
                {changed(s) > 0 ? ` (${changed(s)} changed)` : ""}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        {NUMBERS.map(([field, label, step]) => (
          <div key={field} className="flex items-end gap-1">
            <Field label={label} className="min-w-0 flex-1">
              {(c) => (
                <input
                  {...c}
                  type="number"
                  step={step}
                  value={cur[field] ?? ""}
                  placeholder={String(firm[field])}
                  disabled={disabled}
                  onChange={(e) => put(field, num(e.target.value))}
                  className={ctl}
                />
              )}
            </Field>
            {reset(field, label)}
          </div>
        ))}

        <div className="flex items-end gap-1">
          <Field label="Alignment" className="min-w-0 flex-1">
            {(c) => (
              <NativeSelect
                {...c}
                value={cur.align ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  put("align", (e.target.value || undefined) as StyleValues["align"] | undefined)
                }
                className="w-full"
              >
                <option value="">Firm: {ALIGN_LABEL[firm.align]}</option>
                {(Object.keys(ALIGN_LABEL) as (keyof typeof ALIGN_LABEL)[]).map((a) => (
                  <option key={a} value={a}>
                    {ALIGN_LABEL[a]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {reset("align", "Alignment")}
        </div>

        <div className="flex items-end gap-1">
          <Field label="Line spacing" className="min-w-0 flex-1">
            {(c) => (
              <NativeSelect
                {...c}
                value={lineSel}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value;
                  put(
                    "lineSpacing",
                    v === ""
                      ? undefined
                      : v === "exact"
                        ? { exactPt: 14 }
                        : (v as (typeof LINE_SPACINGS)[number]),
                  );
                }}
                className="w-full"
              >
                <option value="">Firm: {lineText(firm.lineSpacing)}</option>
                {LINE_SPACINGS.map((l) => (
                  <option key={l} value={l}>
                    {LINE_LABEL[l]}
                  </option>
                ))}
                <option value="exact">Exactly</option>
              </NativeSelect>
            )}
          </Field>
          {reset("lineSpacing", "Line spacing")}
        </div>
        {typeof cur.lineSpacing === "object" && (
          <Field label="Exact spacing (pt)">
            {(c) => (
              <input
                {...c}
                type="number"
                step={0.5}
                value={
                  cur.lineSpacing && typeof cur.lineSpacing === "object"
                    ? cur.lineSpacing.exactPt
                    : ""
                }
                disabled={disabled}
                onChange={(e) => {
                  const n = num(e.target.value);
                  if (n !== undefined) put("lineSpacing", { exactPt: n });
                }}
                className={ctl}
              />
            )}
          </Field>
        )}

        <div className="flex items-end gap-1">
          <Field label="First line" className="min-w-0 flex-1">
            {(c) => (
              <NativeSelect
                {...c}
                value={first?.kind ?? ""}
                disabled={disabled}
                onChange={(e) => {
                  const k = e.target.value;
                  put(
                    "firstLine",
                    k === ""
                      ? undefined
                      : k === "none"
                        ? { kind: "none" }
                        : { kind: k as "indent" | "hanging", in: 0.5 },
                  );
                }}
                className="w-full"
              >
                <option value="">Firm: {firstText(firm.firstLine)}</option>
                {(Object.keys(FIRST_LABEL) as (keyof typeof FIRST_LABEL)[]).map((k) => (
                  <option key={k} value={k}>
                    {FIRST_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {reset("firstLine", "First line")}
        </div>
        {first && first.kind !== "none" && (
          <Field label="First line (in)">
            {(c) => (
              <input
                {...c}
                type="number"
                step={0.05}
                value={first.in}
                disabled={disabled}
                onChange={(e) => {
                  const n = num(e.target.value);
                  if (n !== undefined) put("firstLine", { kind: first.kind, in: n });
                }}
                className={ctl}
              />
            )}
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {TOGGLES.map(([field, label]) => (
          <div key={field} className="flex items-end gap-1">
            <Field label={label} className="min-w-0 flex-1">
              {(c) => (
                <NativeSelect
                  {...c}
                  value={cur[field] === undefined ? "" : cur[field] ? "yes" : "no"}
                  disabled={disabled}
                  onChange={(e) =>
                    put(field, e.target.value === "" ? undefined : e.target.value === "yes")
                  }
                  className="w-full"
                >
                  <option value="">Firm: {firm[field] ? "Yes" : "No"}</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </NativeSelect>
              )}
            </Field>
            {reset(field, label)}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
