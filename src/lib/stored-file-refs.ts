import { prisma } from "@/lib/prisma";

/**
 * True when any Document row points at this stored-file key. Draft paths
 * call this before EVERY byte deletion: a draft file's bytes are re-homed
 * (not copied) onto a Document when a matter is created, so a late draft
 * cleanup (retried callback, sweep, racing delete) must never remove bytes a
 * Document now references.
 *
 * Document.fileUrl has no index, so this is a seq scan; it only runs on
 * draft cleanup paths (rare, small tables per firm).
 */
export async function isStoredFileReferenced(fileUrl: string): Promise<boolean> {
  const doc = await prisma.document.findFirst({
    where: { fileUrl },
    select: { id: true },
  });
  return Boolean(doc);
}
