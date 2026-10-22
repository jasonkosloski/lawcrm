/**
 * Server loader for the court format that applies to a record: the
 * matter's venue's format, with its block replacements in one query.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import type { RecordScope } from "@/lib/record-scope";
import { assertScopeAccess } from "@/lib/scope-access";
import type { CourtContext } from "./court-blocks";
import type { FontKey } from "./fonts";
import type { CourtFormatValues } from "./page-style";
import { readStyleOverrides } from "./paragraph-styles";
import type { BlockSource } from "./render";
import type { TemplateDoc } from "./schema";

const num = (d: { toNumber(): number } | null) => (d === null ? null : d.toNumber());

/** The record's court format (null for leads, venue-less matters, or a
 *  venue with no format). Archived formats are returned with
 *  `isActive: false` so callers can say the house style was used. */
export async function loadCourtContext(scope: RecordScope): Promise<CourtContext | null> {
  await assertScopeAccess(scope);
  if (scope.kind !== "matter") return null;
  const matter = await prisma.matter.findUnique({
    where: { id: scope.matterId },
    select: {
      venue: {
        select: {
          courtFormat: {
            include: {
              blocks: {
                include: {
                  replacementBlock: {
                    select: { id: true, name: true, isActive: true, content: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const f = matter?.venue?.courtFormat;
  if (!f) return null;
  const values: CourtFormatValues = {
    fontKey: f.fontKey as FontKey | null,
    fontSizeHalfPt: f.fontSizeHalfPt,
    lineSpacing: f.lineSpacing as CourtFormatValues["lineSpacing"],
    spaceAfterPt: f.spaceAfterPt,
    marginTopIn: num(f.marginTopIn),
    marginRightIn: num(f.marginRightIn),
    marginBottomIn: num(f.marginBottomIn),
    marginLeftIn: num(f.marginLeftIn),
    pageNumbers: f.pageNumbers as CourtFormatValues["pageNumbers"],
    paperSize: f.paperSize as CourtFormatValues["paperSize"],
    styleOverrides: readStyleOverrides(f.styleOverrides, f),
  };
  const replacements = new Map<string, BlockSource>();
  for (const b of f.blocks) {
    replacements.set(b.blockId, {
      ...b.replacementBlock,
      content: b.replacementBlock.content as unknown as TemplateDoc,
    });
  }
  return { id: f.id, name: f.name, isActive: f.isActive, values, replacements };
}
