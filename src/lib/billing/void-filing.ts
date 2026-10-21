/**
 * Replaces an invoice's filed PDFs with VOID-stamped copies, in place:
 * same Document row and name, new stored bytes. Matter access is the
 * caller's job (it only has an invoiceId here). Never throws.
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { deleteFile, readStoredFile, storeFile } from "@/lib/file-storage";
import { isStoredFileReferenced } from "@/lib/stored-file-refs";
import { stampVoid } from "./void-stamp";

export type StampFiledResult = {
  stamped: number;
  failed: number;
  /** Newest stamped document by createdAt, for the client email. */
  latest: { name: string; bytes: Buffer } | null;
};

export async function stampFiledInvoicePdfs(args: {
  invoiceId: string;
  voidedOn: string;
}): Promise<StampFiledResult> {
  let stamped = 0;
  let failed = 0;
  let latest: StampFiledResult["latest"] = null;
  try {
    const docs = await prisma.document.findMany({
      where: { invoiceId: args.invoiceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, fileUrl: true },
    });
    for (const doc of docs) {
      let newKey: string | null = null;
      try {
        if (!doc.fileUrl) throw new Error("no stored file");
        const original = await readStoredFile(doc.fileUrl);
        if (!original) throw new Error("stored file missing");
        const bytes = await stampVoid(original, args.voidedOn);
        const file = new File([new Uint8Array(bytes)], doc.name, {
          type: "application/pdf",
        });
        const stored = await storeFile(file);
        newKey = stored.key;
        const res = await prisma.document.updateMany({
          where: { id: doc.id, fileUrl: doc.fileUrl },
          data: { fileUrl: stored.key, fileSize: stored.size },
        });
        if (res.count === 0) throw new Error("document changed concurrently");
        newKey = null;
        stamped++;
        latest = { name: doc.name, bytes };
        // Best effort; a "Copy to…" sibling may still share the old key.
        try {
          if (!(await isStoredFileReferenced(doc.fileUrl))) {
            await deleteFile(doc.fileUrl);
          }
        } catch {
          /* orphaned bytes are harmless */
        }
      } catch {
        failed++;
        if (newKey) await deleteFile(newKey).catch(() => {});
      }
    }
  } catch {
    failed++;
  }
  return { stamped, failed, latest };
}
