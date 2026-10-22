/**
 * Page-shaped preview of a generated document in the firm's house style.
 * Renders the page frame, logo, strip and CSS through React; only the
 * sanitized fragments from `resolvedToPageParts` go through
 * dangerouslySetInnerHTML. The page is laid out at 8.5in x 96 px and
 * CSS-scaled to the container width.
 */

"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ResolvedDoc } from "@/lib/templates/render";
import type { PreviewPageStyle } from "@/lib/templates/page-style";
import { CELL_SIDES } from "@/lib/templates/schema";
import { CELL_SIDE_ATTR } from "@/lib/templates/table-layout";
import {
  CELL_PAD_PX,
  LOGO_MAX_H_PX,
  LOGO_MAX_W_PX,
  PAGE_WIDTH_PX,
  pageFontFaceCss,
  resolvedToPageParts,
} from "@/lib/templates/to-html";

const HEADING_PT = [6, 4, 2] as const;

const PAGE_CSS = `
[data-page]{box-sizing:border-box;background:#fff;color:#000;font-family:var(--page-family);font-size:var(--page-font-size);line-height:var(--page-line-height);}
[data-page] p,[data-page] ul,[data-page] ol,[data-page] table{margin:0 0 var(--page-space-after);}
[data-page] ul,[data-page] ol{padding-left:2em;}
[data-page] ul{list-style:disc;}
[data-page] ol{list-style:decimal;}
[data-page] li>p{margin:0;}
[data-page] td,[data-page] th{border:1px solid #999;padding:0 ${CELL_PAD_PX}px;vertical-align:top;text-align:left;font-weight:normal;}
[data-page] table{border-collapse:collapse;table-layout:fixed;width:100%;}
[data-page] table[data-width=fit]{table-layout:auto;width:auto;max-width:100%;}
[data-page] table td>*,[data-page] table th>*{margin:0;}
[data-page] p:empty::before{content:"\\a0";}
${CELL_SIDES.map((side) => `[data-page] [${CELL_SIDE_ATTR[side]}=none]{border-${side}-style:none;}\n[data-page] [${CELL_SIDE_ATTR[side]}=thick]{border-${side}:2px solid #000;}`).join("\n")}
[data-page] [data-valign=middle]{vertical-align:middle;}
[data-page] [data-valign=bottom]{vertical-align:bottom;}
[data-page] hr[data-page-break]{border:0;border-top:1px dashed #bbb;margin:0 0 var(--page-space-after);}
[data-page] mark[data-missing]{background:#fde68a;color:inherit;}
[data-page] h1,[data-page] h2,[data-page] h3{font-weight:bold;margin:0 0 var(--page-space-after);}
${HEADING_PT.map((d, i) => `[data-page] h${i + 1}{font-size:calc(var(--page-font-size) + ${d * (96 / 72)}px);}`).join("\n")}
[data-page2]{border-top:1px dashed #bbb;margin-top:var(--page-space-after);}
`;

export function PagePreview(input: {
  body: ResolvedDoc;
  letterhead: ResolvedDoc | null;
  continuation: ResolvedDoc | null;
  style: PreviewPageStyle;
  logoUrl: string | null;
}) {
  const parts = resolvedToPageParts(input);
  const wrap = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / PAGE_WIDTH_PX));
      if (page.current) setHeight(page.current.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (page.current) ro.observe(page.current);
    return () => ro.disconnect();
  }, []);

  const pageStyle = {
    ...parts.style,
    "--page-family": parts.fontFamily,
    width: PAGE_WIDTH_PX,
    minHeight: parts.minHeightPx,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  } as CSSProperties;
  const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" } as const;
  const strip = parts.strip;
  const headerMin = parts.headerMinHeightPx;
  const stripEl = strip && (
    <div data-page2 data-placement={strip.placement}>
      {/* Page 2's top: the same header distance and min height as page 1. */}
      {strip.placement === "top" && headerMin !== null && (
        <div style={{ height: parts.style.paddingTop }} aria-hidden />
      )}
      <div
        style={
          strip.placement === "top" && headerMin !== null ? { minHeight: headerMin } : undefined
        }
      >
        {strip.continuationHtml && (
          // Sanitized by resolvedToHtml.
          <div dangerouslySetInnerHTML={{ __html: strip.continuationHtml }} />
        )}
        {strip.pageLabel && (
          <div
            style={{ textAlign: strip.pageLabel.align, marginBottom: "var(--page-space-after)" }}
          >
            {strip.pageLabel.text}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={wrap}
      data-testid="page-preview"
      className="w-full overflow-hidden rounded-md border border-line bg-surface-2 shadow-sm"
      style={height ? { height: height * scale } : undefined}
    >
      <style>{`${pageFontFaceCss(input.style.font)}\n${PAGE_CSS}`}</style>
      <div ref={page} data-page style={pageStyle}>
        {headerMin !== null && (
          // Word's header area: the body starts at the top margin unless
          // the letterhead is taller.
          <div data-page-header style={{ minHeight: headerMin }}>
            {parts.logo && (
              <div style={{ display: "flex", justifyContent: JUSTIFY[parts.logo.position] }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- firm logo from an API route */}
                <img
                  src={parts.logo.url}
                  alt=""
                  style={{
                    maxWidth: LOGO_MAX_W_PX,
                    maxHeight: LOGO_MAX_H_PX,
                    width: "auto",
                    height: "auto",
                    marginBottom: "var(--page-space-after)",
                  }}
                />
              </div>
            )}
            {parts.letterheadHtml && (
              // Sanitized by resolvedToHtml.
              <div
                data-page-letterhead
                dangerouslySetInnerHTML={{ __html: parts.letterheadHtml }}
              />
            )}
          </div>
        )}
        <div data-page-body dangerouslySetInnerHTML={{ __html: parts.bodyHtml }} />
        {stripEl}
      </div>
    </div>
  );
}
