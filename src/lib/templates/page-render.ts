/**
 * Renders a whole page — body plus the firm style's letterhead and
 * continuation blocks — from one TemplateData. Pure and client-safe: the
 * server uses it for generation and record previews, the template editor
 * for its sample preview.
 *
 * The letterhead/continuation blocks render as a one-node doc holding a
 * block reference, so archived or deleted blocks get exactly the body's
 * placeholders and report entries.
 */

import type { TemplateData } from "./catalog";
import { renderTemplate, type BlockSource, type RenderReport, type ResolvedDoc } from "./render";
import {
  resolvePageStyle,
  type DocumentStyleValues,
  toPreviewPageStyle,
  type LogoRef,
  type PageStyleOf,
  type PreviewPageStyle,
} from "./page-style";
import type { TemplateDoc } from "./schema";

export type PageKind = "letter" | "filing";

/** What a preview sends to <PagePreview/>: serializable, no logo bytes. */
export type PageView = {
  body: ResolvedDoc;
  letterhead: ResolvedDoc | null;
  continuation: ResolvedDoc | null;
  style: PreviewPageStyle;
  logoUrl: string | null;
};

/** The firm style as the template editor's sample preview needs it:
 *  values, where the logo goes and its preview URL — never bytes or keys. */
export type FirmPageStyle = {
  values: DocumentStyleValues;
  logo: LogoRef | null;
  logoUrl: string | null;
};

/** Generation report: the render report plus non-field notes (logo, PDF fonts). */
export type GenerationReport = RenderReport & { warnings: string[] };

const LOGO_ROUTE = "/api/document-style/logo";

/** Cache-busted preview URL for the firm logo. */
export const logoPreviewUrl = (styleUpdatedAt: string) =>
  `${LOGO_ROUTE}?v=${encodeURIComponent(styleUpdatedAt)}`;

/** The logo a preview should show, from the stored columns alone. */
export function logoRefOf(style: {
  logoKey: string | null;
  logoPosition: DocumentStyleValues["logoPosition"];
}): LogoRef | null {
  return style.logoKey && style.logoPosition !== "none" ? { position: style.logoPosition } : null;
}

/** Block ids the firm style adds to a page of this kind (none for filings). */
export function styleBlockIds(kind: PageKind, style: DocumentStyleValues): string[] {
  if (kind !== "letter") return [];
  return [style.letterheadBlockId, style.continuationBlockId].filter(
    (id): id is string => id !== null,
  );
}

/** Adds `from`'s entries to `into`, skipping duplicates. */
export function mergeReport(into: RenderReport, from: RenderReport): void {
  for (const k of ["missing", "invalid", "archivedBlocks"] as const) {
    for (const v of from[k]) if (!into[k].includes(v)) into[k].push(v);
  }
}

const blockDoc = (blockId: string): TemplateDoc => ({
  type: "doc",
  content: [{ type: "block", attrs: { blockId } }],
});

export function renderPage<L extends LogoRef>(input: {
  doc: TemplateDoc;
  kind: PageKind;
  data: TemplateData;
  blocks: Map<string, BlockSource>;
  style: DocumentStyleValues;
  logo: L | null;
}): {
  body: ResolvedDoc;
  letterhead: ResolvedDoc | null;
  continuation: ResolvedDoc | null;
  style: PageStyleOf<L>;
  report: RenderReport;
} {
  const ctx = { data: input.data, blocks: input.blocks };
  const style = resolvePageStyle<L>(input.kind, input.style, input.logo);
  const body = renderTemplate(input.doc, ctx);
  const report = body.report;
  const part = (blockId: string | null | undefined) => {
    if (!blockId) return null;
    const r = renderTemplate(blockDoc(blockId), ctx);
    mergeReport(report, r.report);
    return r.doc;
  };
  return {
    body: body.doc,
    letterhead: part(style.letterhead?.blockId),
    continuation: part(style.continuationBlockId),
    style,
    report,
  };
}

/** A preview page: body + firm blocks, logo shown via `logoUrl` only. */
export function renderPageView(input: {
  doc: TemplateDoc;
  kind: PageKind;
  data: TemplateData;
  blocks: Map<string, BlockSource>;
  style: DocumentStyleValues;
  logo: LogoRef | null;
  logoUrl: string | null;
}): { page: PageView; report: RenderReport } {
  const r = renderPage(input);
  return {
    page: {
      body: r.body,
      letterhead: r.letterhead,
      continuation: r.continuation,
      style: toPreviewPageStyle(r.style),
      logoUrl: r.style.letterhead?.logo ? input.logoUrl : null,
    },
    report: r.report,
  };
}
