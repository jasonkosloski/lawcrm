import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Open matters (not archived, stage not terminal) the "require a signed
 * originating document" switch would flag: no agreement record, a status
 * other than signed, or "signed" with no linked document. Unscoped: it
 * is the raw predicate. Callers add `matterAccessWhere` when the viewer
 * is not guaranteed to see every matter, and gate who may see it (the
 * settings page and the dashboard triage card are admin-only).
 */
export const MISSING_SIGNED_AGREEMENT_WHERE: Prisma.MatterWhereInput = {
  isArchived: false,
  stage: { isTerminal: false },
  OR: [
    { agreement: { is: null } },
    { agreement: { status: { not: "signed" } } },
    { agreement: { documentId: null } },
  ],
};

export function countMattersMissingSignedAgreement(): Promise<number> {
  return prisma.matter.count({ where: MISSING_SIGNED_AGREEMENT_WHERE });
}
