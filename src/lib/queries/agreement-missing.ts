import { prisma } from "@/lib/prisma";

/**
 * Open matters (not archived, stage not terminal) the "require a signed
 * originating document" switch would flag: no agreement record, a status
 * other than signed, or "signed" with no linked document. Admin settings
 * only; the caller gates.
 */
export function countMattersMissingSignedAgreement(): Promise<number> {
  return prisma.matter.count({
    where: {
      isArchived: false,
      stage: { isTerminal: false },
      OR: [
        { agreement: { is: null } },
        { agreement: { status: { not: "signed" } } },
        { agreement: { documentId: null } },
      ],
    },
  });
}
