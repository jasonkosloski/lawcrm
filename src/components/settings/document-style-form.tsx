/**
 * Document style form — the firm's house style for generated letters
 * and filings, with a live sample page beside it. Text size and spacing
 * live in the paragraph styles form (Body), not here.
 *
 * The form is controlled so the preview follows every keystroke. Save
 * sends `expectedUpdatedAt` and adopts the returned timestamp; logo
 * upload/remove go through the logo route (ADR-034) with the same
 * `expectedUpdatedAt`, and on success adopt the returned timestamp (so the
 * next Save is not stale) and, only when the upload moved it off "none",
 * the logo position (an unsaved local position edit is kept otherwise). Users without `firm.edit_document_style` get the same page
 * with every control disabled.
 */

"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { saveDocumentStyle } from "@/app/actions/document-style";
import { PagePreview } from "@/components/templates/page-preview";
import { Button } from "@/components/ui/button";
import { Field, FormErrorBanner, inputClass } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { FONTS } from "@/lib/templates/fonts";
import {
  FONT_KEYS,
  LOGO_POSITIONS,
  MARGIN_IN_MAX,
  MARGIN_IN_MIN,
  PAGE_NUMBER_POSITIONS,
  resolvePageStyle,
  type DocumentStyleValues,
  type FontKey,
  type LoadedLogo,
  type LogoPosition,
} from "@/lib/templates/page-style";
import type { ResolvedDoc } from "@/lib/templates/render";
import { pageFontFaceCss, previewFontFamily } from "@/lib/templates/to-html";

export type StyleBlockOption = { id: string; name: string; isActive: boolean };

const LOGO_URL = "/api/document-style/logo";
const GARAMOND_NOTE = "Line breaks may differ slightly between Word and PDF.";
const PAGE_NUMBERS_NOTE =
  "Letters show the page number in the later-page header. The bottom center / bottom right choice applies to filings.";

const LOGO_LABEL: Record<LogoPosition, string> = {
  none: "No logo",
  left: "Left",
  center: "Center",
  right: "Right",
};
const PAGE_NUMBER_LABEL = {
  none: "None",
  bottom_center: "Bottom center",
  bottom_right: "Bottom right",
} as const;

const ALL_FONT_FACES = FONT_KEYS.map(pageFontFaceCss).join("\n");

/** Stand-in for the logo bytes: the preview only needs presence + position. */
const placeholderLogo = (position: "left" | "center" | "right"): LoadedLogo => ({
  bytes: new Uint8Array(0),
  contentType: "image/png",
  position,
});

type Props = {
  initial: DocumentStyleValues;
  /** ISO timestamp of the loaded row (the optimistic-lock token). */
  updatedAt: string;
  /** Called with the new token after any save or logo change. */
  onUpdatedAt?: (updatedAt: string) => void;
  hasLogo: boolean;
  blocks: StyleBlockOption[];
  /** Rendered sample letter body. */
  body: ResolvedDoc;
  /** Rendered content of every block a select can pick, by id. */
  blockDocs: Record<string, ResolvedDoc>;
  canEdit: boolean;
};

export function DocumentStyleForm({
  initial,
  updatedAt: initialUpdatedAt,
  onUpdatedAt,
  hasLogo: initialHasLogo,
  blocks,
  body,
  blockDocs,
  canEdit,
}: Props) {
  const [values, setValues] = useState<DocumentStyleValues>(initial);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [hasLogo, setHasLogo] = useState(initialHasLogo);
  const [logoVersion, setLogoVersion] = useState(initialUpdatedAt);
  // Follow the shared token when a sibling form saves (see DocumentSettings).
  const [seenProp, setSeenProp] = useState(initialUpdatedAt);
  if (seenProp !== initialUpdatedAt) {
    setSeenProp(initialUpdatedAt);
    setUpdatedAt(initialUpdatedAt);
  }
  const commit = (next: string) => {
    setUpdatedAt(next);
    onUpdatedAt?.(next);
  };
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof DocumentStyleValues>(key: K, value: DocumentStyleValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  };
  const setMargin = (key: "marginTopIn" | "marginRightIn" | "marginBottomIn" | "marginLeftIn") => {
    return (raw: string) => {
      // An empty box is mid-edit; hold the last good number.
      if (raw.trim() === "") return;
      const n = Number(raw);
      if (Number.isFinite(n)) set(key, n);
    };
  };

  const letterheadOptions = optionsFor(blocks, values.letterheadBlockId);
  const continuationOptions = optionsFor(blocks, values.continuationBlockId);

  const showLogo = hasLogo && values.logoPosition !== "none";
  const style = resolvePageStyle(
    "letter",
    values,
    showLogo ? placeholderLogo(values.logoPosition as "left" | "center" | "right") : null,
  );
  const docFor = (id: string | null) => (id ? (blockDocs[id] ?? null) : null);

  const save = () => {
    setError(null);
    setStale(false);
    setSaved(false);
    startTransition(async () => {
      const res = await saveDocumentStyle({ ...values, expectedUpdatedAt: updatedAt });
      if (res.ok) {
        commit(res.updatedAt);
        setSaved(true);
      } else {
        setError(res.error);
        setStale(res.error.startsWith("Someone else saved"));
      }
    });
  };

  const adopt = (r: {
    updatedAt: string;
    logoPosition: LogoPosition;
    positionChanged: boolean;
  }) => {
    commit(r.updatedAt);
    setLogoVersion(r.updatedAt);
    if (r.positionChanged) {
      // The server moved none -> left; keep a position the user already picked.
      setValues((v) => (v.logoPosition === "none" ? { ...v, logoPosition: r.logoPosition } : v));
    }
  };

  const callLogo = async (
    { url = LOGO_URL, ...init }: RequestInit & { url?: string },
    onOk: () => void,
  ) => {
    setLogoError(null);
    setStale(false);
    setLogoBusy(true);
    try {
      const res = await fetch(url, init);
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        updatedAt?: string;
        logoPosition?: LogoPosition;
        logoPositionChanged?: boolean;
      } | null;
      if (res.ok && json?.ok && json.updatedAt && json.logoPosition) {
        adopt({
          updatedAt: json.updatedAt,
          logoPosition: json.logoPosition,
          positionChanged: json.logoPositionChanged === true,
        });
        onOk();
        setSaved(false);
      } else {
        setLogoError(json?.error ?? "The logo couldn't be changed.");
        if (res.status === 409) setStale(true);
      }
    } catch {
      setLogoError("The logo couldn't be changed.");
    } finally {
      setLogoBusy(false);
    }
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("expectedUpdatedAt", updatedAt);
    void callLogo({ method: "POST", body: fd }, () => setHasLogo(true));
  };
  const removeLogo = () =>
    void callLogo(
      {
        method: "DELETE",
        url: `${LOGO_URL}?expectedUpdatedAt=${encodeURIComponent(updatedAt)}`,
      },
      () => setHasLogo(false),
    );

  const dis = !canEdit;
  const ctl = (extra = "") => `${inputClass(false, "md")} ${extra}`;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <style>{ALL_FONT_FACES}</style>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canEdit) save();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Font" className="col-span-2">
            {(c) => (
              <NativeSelect
                {...c}
                value={values.fontKey}
                disabled={dis}
                onChange={(e) => set("fontKey", e.target.value as FontKey)}
                className="w-full"
              >
                {FONT_KEYS.map((k) => (
                  <option key={k} value={k} style={{ fontFamily: `"${previewFontFamily(k)}"` }}>
                    {FONTS[k].label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {values.fontKey === "garamond" && (
            <p className="col-span-2 text-2xs text-ink-3">{GARAMOND_NOTE}</p>
          )}
        </div>

        <fieldset className="grid grid-cols-2 gap-3" disabled={dis}>
          <legend className="mb-1 text-xs font-medium text-ink-2">Margins</legend>
          {(
            [
              ["marginTopIn", "Top margin (in)"],
              ["marginRightIn", "Right margin (in)"],
              ["marginBottomIn", "Bottom margin (in)"],
              ["marginLeftIn", "Left margin (in)"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              {(c) => (
                <input
                  {...c}
                  type="number"
                  min={MARGIN_IN_MIN}
                  max={MARGIN_IN_MAX}
                  step={0.05}
                  value={values[key]}
                  disabled={dis}
                  onChange={(e) => setMargin(key)(e.target.value)}
                  className={ctl()}
                />
              )}
            </Field>
          ))}
        </fieldset>

        <Field label="Letterhead block">
          {(c) => (
            <NativeSelect
              {...c}
              value={values.letterheadBlockId ?? ""}
              disabled={dis}
              onChange={(e) => set("letterheadBlockId", e.target.value || null)}
              className="w-full"
            >
              <option value="">None</option>
              {letterheadOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.isActive ? "" : " (archived)"}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Logo position">
            {(c) => (
              <NativeSelect
                {...c}
                value={values.logoPosition}
                disabled={dis}
                onChange={(e) => set("logoPosition", e.target.value as LogoPosition)}
                className="w-full"
              >
                {LOGO_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {LOGO_LABEL[p]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {canEdit && (
            <div className="flex flex-col gap-1">
              <Field label="Upload logo" hint="PNG or JPEG, 1 MB or smaller." className="min-w-0">
                {(c) => (
                  <input
                    {...c}
                    type="file"
                    accept="image/png,image/jpeg"
                    disabled={logoBusy}
                    onChange={(e) => {
                      upload(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                    className="text-2xs"
                  />
                )}
              </Field>
              {hasLogo && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={logoBusy}
                  onClick={removeLogo}
                >
                  Remove logo
                </Button>
              )}
            </div>
          )}
        </div>
        {logoError && <FormErrorBanner message={logoError} />}

        <Field label="Continuation block (pages 2+)">
          {(c) => (
            <NativeSelect
              {...c}
              value={values.continuationBlockId ?? ""}
              disabled={dis}
              onChange={(e) => set("continuationBlockId", e.target.value || null)}
              className="w-full"
            >
              <option value="">None</option>
              {continuationOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.isActive ? "" : " (archived)"}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        <Field label="Page numbers" hint={PAGE_NUMBERS_NOTE}>
          {(c) => (
            <NativeSelect
              {...c}
              value={values.pageNumbers}
              disabled={dis}
              onChange={(e) => set("pageNumbers", e.target.value as typeof values.pageNumbers)}
              className="w-full"
            >
              {PAGE_NUMBER_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {PAGE_NUMBER_LABEL[p]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

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
            <Button type="submit" disabled={pending || logoBusy}>
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
          body={body}
          letterhead={docFor(values.letterheadBlockId)}
          continuation={docFor(values.continuationBlockId)}
          style={style}
          logoUrl={showLogo ? `${LOGO_URL}?v=${encodeURIComponent(logoVersion)}` : null}
        />
      </div>
    </div>
  );
}

/** Active blocks plus the currently selected one even if archived. */
function optionsFor(blocks: StyleBlockOption[], selected: string | null): StyleBlockOption[] {
  return blocks.filter((b) => b.isActive || b.id === selected);
}
