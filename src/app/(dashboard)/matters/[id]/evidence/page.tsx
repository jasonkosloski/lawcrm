/**
 * Matter detail — Evidence review tab.
 *
 * Every flag across the matter's documents — recordings, PDFs,
 * rendered text, images — grouped by document (name · type · flag
 * count) with flags in anchor order inside each group. One query
 * (`getMatterFlaggedMoments`) + JS grouping — see
 * src/lib/queries/evidence.ts.
 *
 * Category filter pills are URL-driven (`?category=…`, timeline-tab
 * pattern) so links and the back button work; counts come from the
 * unfiltered set so empty pills dim out. Each flag shows its anchor
 * via `flagAnchorLabel` (mm:ss / p. N / “quote…” / Document) and
 * deep-links into the document viewer with `?flag={id}` — the
 * viewer resolves the anchor and seeks / opens the page /
 * highlights the quote. (Media's older `?t=` links still work.)
 *
 * Flag creation lives in the viewer (you flag while reviewing);
 * this page is the cross-document review index. Transcripts, OCR,
 * and EvidenceSync multi-track alignment are queued follow-ups
 * (FEATURES.md).
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AudioLines,
  File,
  FileText,
  Film,
  Flag,
  Image as ImageIcon,
  Table,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { cn, plural } from "@/lib/utils";
import {
  FLAG_CATEGORIES,
  FLAG_CATEGORY_LABEL,
  type FlagCategory,
} from "@/lib/constants/flag-category";
import { flagAnchorLabel } from "@/lib/flag-anchor";
import { getMatterFlaggedMoments } from "@/lib/queries/evidence";
import type { DocumentRenderer } from "@/components/documents-viewer/resolve-renderer";
import { EmptyState } from "@/components/shared/empty-state";
import { FlagCategoryChip } from "@/components/evidence/flag-category-chip";
import { Card, CardContent } from "@/components/ui/card";

/** Renderer → group-header icon. Mirrors the viewer's renderer
 *  resolution, so the icon always matches what actually opens. */
const RENDERER_ICON: Record<DocumentRenderer, LucideIcon> = {
  audio: AudioLines,
  video: Film,
  pdf: FileText,
  docx: FileText,
  text: FileText,
  csv: Table,
  image: ImageIcon,
  doc_legacy: File,
  unsupported: File,
};

/** Renderer → human chip label ("video", "PDF", "Word", …). */
const RENDERER_LABEL: Record<DocumentRenderer, string> = {
  audio: "audio",
  video: "video",
  pdf: "PDF",
  docx: "Word",
  text: "text",
  csv: "CSV",
  image: "image",
  doc_legacy: "Word (.doc)",
  unsupported: "file",
};

export default async function MatterEvidencePage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/evidence">) {
  const { id } = await params;
  const sp = await searchParams;
  const rawCategory = Array.isArray(sp.category) ? sp.category[0] : sp.category;
  const filter: FlagCategory | null =
    typeof rawCategory === "string" &&
    (FLAG_CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as FlagCategory)
      : null;

  const matter = await prisma.matter.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!matter) notFound();

  const groups = await getMatterFlaggedMoments(id);

  // Pill counts from the UNFILTERED set — the pills describe what's
  // there to review, not what the current filter shows.
  const counts = new Map<string, number>();
  let total = 0;
  for (const g of groups) {
    for (const m of g.moments) {
      counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
      total++;
    }
  }

  const filtered = filter
    ? groups
        .map((g) => ({
          ...g,
          moments: g.moments.filter((m) => m.category === filter),
        }))
        .filter((g) => g.moments.length > 0)
    : groups;

  return (
    <div className="p-5 max-w-3xl flex flex-col gap-4 animate-page-enter">
      {/* Filter pills — URL is the source of truth (timeline pattern). */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterPill
          href={`/matters/${id}/evidence`}
          label="All"
          count={total}
          active={filter === null}
        />
        {FLAG_CATEGORIES.map((c) => (
          <FilterPill
            key={c}
            href={`/matters/${id}/evidence?category=${c}`}
            label={FLAG_CATEGORY_LABEL[c]}
            count={counts.get(c) ?? 0}
            active={filter === c}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          framed
          icon={Flag}
          title={
            filter
              ? `No ${FLAG_CATEGORY_LABEL[filter].toLowerCase()} flags yet`
              : "No flags yet"
          }
          description={
            filter ? (
              "Nothing in this category on this matter — clear the filter or flag more from the viewer."
            ) : (
              <>
                Open any document from the{" "}
                <Link
                  href={`/matters/${id}/documents`}
                  className="text-brand-700 underline underline-offset-2 hover:text-brand-500"
                >
                  Documents tab
                </Link>{" "}
                and flag what matters — a moment in a recording, a page
                in a PDF, a passage in a transcript, or the file as a
                whole. Every flag lands here, grouped by document, ready
                to walk in order.
              </>
            )
          }
        />
      ) : (
        filtered.map((g) => {
          const TypeIcon = RENDERER_ICON[g.renderer] ?? File;
          return (
            <Card key={g.documentId} className="p-0 overflow-hidden">
              <CardContent className="px-0 py-0">
                {/* Group header — document identity + renderer type. */}
                <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper-2/50 px-4 py-2">
                  <TypeIcon className="h-3.5 w-3.5 text-ink-3" aria-hidden />
                  <Link
                    href={`/matters/${id}/documents/${g.documentId}`}
                    className="min-w-0 truncate text-xs font-semibold text-ink hover:text-brand-700"
                  >
                    {g.documentName}
                  </Link>
                  <span className="inline-block rounded-full border border-line bg-white px-2 py-0.5 text-2xs font-medium text-ink-3">
                    {RENDERER_LABEL[g.renderer] ?? g.renderer}
                  </span>
                  <span className="ml-auto font-mono text-2xs text-ink-4">
                    {plural(g.moments.length, "flag")}
                  </span>
                </div>

                <ul className="flex flex-col">
                  {g.moments.map((m) => (
                    <li
                      key={m.id}
                      className="border-b border-line/60 last:border-b-0"
                    >
                      <Link
                        href={`/matters/${id}/documents/${g.documentId}?flag=${m.id}`}
                        className="flex flex-col gap-1 px-4 py-2.5 transition-colors hover:bg-paper-2/40"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <FlagCategoryChip category={m.category} />
                          {/* Anchor label — mm:ss / p. N / “quote…” /
                              Document (flagAnchorLabel). */}
                          <span className="min-w-0 truncate font-mono text-2xs text-brand-700">
                            {flagAnchorLabel(m)}
                          </span>
                          <span
                            title={m.flaggedByName ?? undefined}
                            className="ml-auto inline-flex h-4.5 w-4.5 items-center justify-center rounded-full border border-line bg-paper-2 text-3xs font-medium text-ink-3"
                          >
                            {m.flaggedByInitials ?? "—"}
                          </span>
                        </div>
                        <div className="text-xs leading-snug text-ink-2">
                          {m.description}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function FilterPill({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-2xs font-medium border transition-colors",
        active
          ? "bg-brand-500 text-white border-brand-500"
          : count === 0
            ? "bg-paper text-ink-4 border-line opacity-60 cursor-default pointer-events-none"
            : "bg-white text-ink-2 border-line hover:border-brand-300 hover:text-brand-700"
      )}
    >
      {label}
      <span
        className={cn(
          "font-mono text-2xs",
          active ? "text-white/80" : "text-ink-4"
        )}
      >
        {count}
      </span>
    </Link>
  );
}
