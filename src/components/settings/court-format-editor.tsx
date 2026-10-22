/**
 * Court format editor — one court's layout overrides and block swaps,
 * with a live sample filing beside the form.
 *
 * Each layout setting has a "Use house style" checkbox: checked means
 * null (the house value applies), unchecking seeds the field with the
 * current house value. The sample page is rendered client-side with the
 * house style as the base and the form's values applied, through the same
 * renderPageView the server uses; the sample body inserts every block
 * that has a replacement so the preview shows the swaps. Save sends
 * `expectedUpdatedAt` and adopts the returned timestamp; a new format
 * routes to its own page after the first save. Without permission every
 * control is disabled.
 */

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, X } from "lucide-react";
import { saveCourtFormat } from "@/app/actions/court-formats";
import { PagePreview } from "@/components/templates/page-preview";
import { Button } from "@/components/ui/button";
import { Field, FormErrorBanner, inputClass } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import type { CourtContext } from "@/lib/templates/court-blocks";
import { SAMPLE_TEMPLATE_DATA } from "@/lib/templates/catalog";
import { FONTS } from "@/lib/templates/fonts";
import { renderPageView } from "@/lib/templates/page-render";
import {
  COURT_SYSTEMS,
  FONT_KEYS,
  LINE_SPACINGS,
  MARGIN_IN_MAX,
  MARGIN_IN_MIN,
  PAGE_NUMBER_POSITIONS,
  PAPER_SIZES,
  type CourtFormatValues,
  type CourtSystem,
  type DocumentStyleValues,
  type FontKey,
} from "@/lib/templates/page-style";
import type { BlockSource } from "@/lib/templates/render";
import type { TemplateDoc } from "@/lib/templates/schema";
import { pageFontFaceCss, previewFontFamily } from "@/lib/templates/to-html";

export type CourtFormatEditorBlock = BlockSource;
export type ReplacementRow = { blockId: string; replacementBlockId: string };
export type CourtFormatEditorInitial = {
  /** Null for a format that has not been created yet. */
  id: string | null;
  name: string;
  courtSystem: CourtSystem;
  values: CourtFormatValues;
  replacements: ReplacementRow[];
  /** ISO timestamp of the loaded row (the optimistic-lock token). */
  updatedAt: string | null;
};

const ALL_FONT_FACES = FONT_KEYS.map(pageFontFaceCss).join("\n");
const SYSTEM_LABEL: Record<CourtSystem, string> = {
  state: "State",
  federal: "Federal",
  other: "Other",
};
const PAPER_LABEL = { letter: "Letter (8.5 × 11 in)", legal: "Legal (8.5 × 14 in)" } as const;
const LINE_LABEL = { single: "Single", "1.15": "1.15", "1.5": "1.5", double: "Double" } as const;
const PAGE_NUMBER_LABEL = {
  none: "None",
  bottom_center: "Bottom center",
  bottom_right: "Bottom right",
} as const;
const SIZES = Array.from({ length: 9 }, (_, i) => 10 + i * 0.5);
const STALE_PREFIX = "Someone else saved";
const INCOMPLETE = "Choose both blocks for each replacement, or remove the row.";

const para = (text: string) => ({
  type: "paragraph" as const,
  content: [{ type: "text" as const, text }],
});
/** A short filing that includes each replaced block, so swaps show up. */
function sampleFiling(sourceIds: string[]): TemplateDoc {
  return {
    type: "doc",
    content: [
      para("Sample filing"),
      ...sourceIds.map((blockId) => ({ type: "block" as const, attrs: { blockId } })),
      para(
        "This sample shows how a filing will look in this court's format: the font, spacing, margins, paper size and page numbers you choose here replace the house style for filings in venues that use this format.",
      ),
      para("Respectfully submitted,"),
    ],
  } as TemplateDoc;
}

export function CourtFormatEditor({
  initial,
  house,
  blocks,
  canSave,
}: {
  initial: CourtFormatEditorInitial;
  house: DocumentStyleValues;
  blocks: CourtFormatEditorBlock[];
  canSave: boolean;
}) {
  const router = useRouter();
  const [id, setId] = useState(initial.id);
  const [name, setName] = useState(initial.name);
  const [courtSystem, setCourtSystem] = useState<CourtSystem>(initial.courtSystem);
  const [values, setValues] = useState<CourtFormatValues>(initial.values);
  const [rows, setRows] = useState<ReplacementRow[]>(initial.replacements);
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, startTransition] = useTransition();

  const touch = () => setSaved(false);
  const set = <K extends keyof CourtFormatValues>(key: K, value: CourtFormatValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    touch();
  };
  const setMargin = (key: "marginTopIn" | "marginRightIn" | "marginBottomIn" | "marginLeftIn") => {
    return (raw: string) => {
      // An empty box is mid-edit; hold the last good number.
      if (raw.trim() === "") return;
      const n = Number(raw);
      if (Number.isFinite(n)) set(key, n);
    };
  };
  const setRow = (i: number, patch: Partial<ReplacementRow>) => {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
    touch();
  };

  const complete = rows.filter((r) => r.blockId && r.replacementBlockId);
  const blockById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  const page = useMemo(() => {
    const replacements = new Map<string, BlockSource>();
    for (const r of complete) {
      const rep = blockById.get(r.replacementBlockId);
      if (rep) replacements.set(r.blockId, rep);
    }
    const court: CourtContext = {
      id: id ?? "preview",
      name,
      isActive: true,
      values,
      replacements,
    };
    return renderPageView({
      doc: sampleFiling(complete.map((r) => r.blockId)),
      kind: "filing",
      data: SAMPLE_TEMPLATE_DATA,
      blocks: blockById,
      style: house,
      logo: null,
      logoUrl: null,
      court,
    }).page;
    // `complete` is derived from rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, values, name, id, house, blockById]);

  // Active blocks plus any archived one already chosen in this row.
  const optionsFor = (selected: string, exclude: Set<string>) =>
    blocks.filter((b) => !exclude.has(b.id) && (b.isActive || b.id === selected));

  const save = () => {
    setError(null);
    setStale(false);
    setSaved(false);
    if (rows.some((r) => !r.blockId || !r.replacementBlockId)) {
      setError(INCOMPLETE);
      return;
    }
    startTransition(async () => {
      const res = await saveCourtFormat({
        ...(id ? { id } : {}),
        name,
        courtSystem,
        ...values,
        replacements: rows,
        ...(id && updatedAt ? { expectedUpdatedAt: updatedAt } : {}),
      });
      if (res.ok) {
        const created = !id;
        setId(res.id);
        setUpdatedAt(res.updatedAt);
        setSaved(true);
        if (created) router.replace(`/settings/court-formats/${res.id}`);
      } else {
        setError(res.error);
        setStale(res.error.startsWith(STALE_PREFIX));
      }
    });
  };

  const dis = !canSave;
  const ctl = (extra = "") => `${inputClass(false, "md")} ${extra}`;

  /** A layout setting: label + control + "Use house style" checkbox. */
  const setting = <K extends keyof CourtFormatValues>(
    key: K,
    label: string,
    houseValue: NonNullable<CourtFormatValues[K]>,
    control: (props: {
      id: string;
      value: NonNullable<CourtFormatValues[K]>;
      disabled: boolean;
    }) => React.ReactNode,
    className = "",
  ) => {
    const current = values[key];
    const isHouse = current === null;
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <Field label={label}>
          {(c) =>
            control({
              id: c.id,
              value: (isHouse ? houseValue : current) as NonNullable<CourtFormatValues[K]>,
              disabled: dis || isHouse,
            })
          }
        </Field>
        <label className="inline-flex items-center gap-1.5 text-2xs text-ink-3">
          <input
            type="checkbox"
            aria-label={`Use house style for ${label}`}
            checked={isHouse}
            disabled={dis}
            onChange={(e) =>
              set(key, (e.target.checked ? null : houseValue) as CourtFormatValues[K])
            }
          />
          Use house style
        </label>
      </div>
    );
  };

  const marginSetting = (
    key: "marginTopIn" | "marginRightIn" | "marginBottomIn" | "marginLeftIn",
    label: string,
  ) =>
    setting(key, label, house[key], (c) => (
      <input
        id={c.id}
        type="number"
        min={MARGIN_IN_MIN}
        max={MARGIN_IN_MAX}
        step={0.05}
        value={c.value}
        disabled={c.disabled}
        onChange={(e) => setMargin(key)(e.target.value)}
        className={ctl()}
      />
    ));

  const chosenSources = (except: number) =>
    new Set(rows.filter((_, j) => j !== except).map((r) => r.blockId));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <style>{ALL_FONT_FACES}</style>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2">
            {(c) => (
              <input
                {...c}
                value={name}
                maxLength={120}
                disabled={dis}
                onChange={(e) => {
                  setName(e.target.value);
                  touch();
                }}
                className={ctl()}
              />
            )}
          </Field>
          <Field label="Court system">
            {(c) => (
              <NativeSelect
                {...c}
                value={courtSystem}
                disabled={dis}
                onChange={(e) => {
                  setCourtSystem(e.target.value as CourtSystem);
                  touch();
                }}
                className="w-full"
              >
                {COURT_SYSTEMS.map((s) => (
                  <option key={s} value={s}>
                    {SYSTEM_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Paper size">
            {(c) => (
              <NativeSelect
                {...c}
                value={values.paperSize}
                disabled={dis}
                onChange={(e) => set("paperSize", e.target.value as CourtFormatValues["paperSize"])}
                className="w-full"
              >
                {PAPER_SIZES.map((p) => (
                  <option key={p} value={p}>
                    {PAPER_LABEL[p]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {setting(
            "fontKey",
            "Font",
            house.fontKey,
            (c) => (
              <NativeSelect
                id={c.id}
                value={c.value}
                disabled={c.disabled}
                onChange={(e) => set("fontKey", e.target.value as FontKey)}
                className="w-full"
              >
                {FONT_KEYS.map((k) => (
                  <option key={k} value={k} style={{ fontFamily: `"${previewFontFamily(k)}"` }}>
                    {FONTS[k].label}
                  </option>
                ))}
              </NativeSelect>
            ),
            "col-span-2",
          )}
          {setting("fontSizeHalfPt", "Font size", house.fontSizeHalfPt, (c) => (
            <NativeSelect
              id={c.id}
              value={c.value}
              disabled={c.disabled}
              onChange={(e) => set("fontSizeHalfPt", Number(e.target.value))}
              className="w-full"
            >
              {SIZES.map((pt) => (
                <option key={pt} value={pt * 2}>
                  {pt} pt
                </option>
              ))}
            </NativeSelect>
          ))}
          {setting("lineSpacing", "Line spacing", house.lineSpacing, (c) => (
            <NativeSelect
              id={c.id}
              value={c.value}
              disabled={c.disabled}
              onChange={(e) => set("lineSpacing", e.target.value as (typeof LINE_SPACINGS)[number])}
              className="w-full"
            >
              {LINE_SPACINGS.map((l) => (
                <option key={l} value={l}>
                  {LINE_LABEL[l]}
                </option>
              ))}
            </NativeSelect>
          ))}
          {setting("spaceAfterPt", "Space after paragraph (pt)", house.spaceAfterPt, (c) => (
            <input
              id={c.id}
              type="number"
              min={0}
              max={24}
              step={1}
              value={c.value}
              disabled={c.disabled}
              onChange={(e) => {
                if (e.target.value !== "") set("spaceAfterPt", Number(e.target.value));
              }}
              className={ctl()}
            />
          ))}
          {setting("pageNumbers", "Page numbers", house.pageNumbers, (c) => (
            <NativeSelect
              id={c.id}
              value={c.value}
              disabled={c.disabled}
              onChange={(e) =>
                set("pageNumbers", e.target.value as (typeof PAGE_NUMBER_POSITIONS)[number])
              }
              className="w-full"
            >
              {PAGE_NUMBER_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {PAGE_NUMBER_LABEL[p]}
                </option>
              ))}
            </NativeSelect>
          ))}
          {marginSetting("marginTopIn", "Top margin (in)")}
          {marginSetting("marginRightIn", "Right margin (in)")}
          {marginSetting("marginBottomIn", "Bottom margin (in)")}
          {marginSetting("marginLeftIn", "Left margin (in)")}
        </div>

        <fieldset className="flex flex-col gap-2" disabled={dis}>
          <legend className="mb-1 text-xs font-medium text-ink-2">Block replacements</legend>
          <p className="text-2xs text-ink-4">
            In filings using this format, each block on the left renders as the block on the right.
          </p>
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <NativeSelect
                aria-label={`Block to replace ${i + 1}`}
                value={row.blockId}
                disabled={dis}
                onChange={(e) => setRow(i, { blockId: e.target.value })}
                className="min-w-0 flex-1"
              >
                <option value="">Select block…</option>
                {optionsFor(row.blockId, chosenSources(i)).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.isActive ? "" : " (archived)"}
                  </option>
                ))}
              </NativeSelect>
              <span aria-hidden className="text-xs text-ink-3">
                →
              </span>
              <NativeSelect
                aria-label={`Replacement block ${i + 1}`}
                value={row.replacementBlockId}
                disabled={dis}
                onChange={(e) => setRow(i, { replacementBlockId: e.target.value })}
                className="min-w-0 flex-1"
              >
                <option value="">Select replacement…</option>
                {optionsFor(row.replacementBlockId, new Set(row.blockId ? [row.blockId] : [])).map(
                  (b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.isActive ? "" : " (archived)"}
                    </option>
                  ),
                )}
              </NativeSelect>
              {canSave && (
                <button
                  type="button"
                  aria-label={`Remove replacement ${i + 1}`}
                  onClick={() => {
                    setRows((r) => r.filter((_, j) => j !== i));
                    touch();
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-brand-soft hover:text-brand-700"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          {canSave && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setRows((r) => [...r, { blockId: "", replacementBlockId: "" }]);
                  touch();
                }}
              >
                <Plus size={14} /> Add replacement
              </Button>
            </div>
          )}
        </fieldset>

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
        {canSave && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-2xs text-ink-3" role="status">
                <CheckCircle2 size={12} />
                Saved
              </span>
            )}
          </div>
        )}
      </form>

      <div className="min-w-0">
        <PagePreview
          body={page.body}
          letterhead={page.letterhead}
          continuation={page.continuation}
          style={page.style}
          logoUrl={page.logoUrl}
        />
      </div>
    </div>
  );
}
