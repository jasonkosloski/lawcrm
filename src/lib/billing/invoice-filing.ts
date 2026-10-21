import "server-only";

import { prisma } from "@/lib/prisma";
import { deleteFile, storeFile } from "@/lib/file-storage";
import { dateOnlyKey } from "@/lib/format-date";
import type { InvoiceEmailKind } from "@/lib/billing/invoice-email";

const INVOICES_FOLDER_NAME = "Invoices";

const KIND_WORD: Record<InvoiceEmailKind | "void", string> = {
  initial: "sent",
  updated: "updated",
  resend: "resent",
  void: "void",
};

async function invoicesFolder(matterId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    // Serialize creators per matter so two concurrent sends can't both
    // create the folder (same handling as portal_uploads).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoices:${matterId}`}))`;
    const find = () =>
      tx.documentFolder.findFirst({
        where: { matterId, systemKind: "invoices" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
    const existing = await find();
    if (existing) return existing.id;
    await tx.documentFolder.create({
      data: {
        matterId,
        parentId: null,
        name: INVOICES_FOLDER_NAME,
        systemKind: "invoices",
        clientShared: false,
      },
    });
    return (await find())!.id;
  });
}

/** File the emailed invoice PDF into the matter's "Invoices" system
 *  folder so the firm keeps a copy. Throws on failure (the stored file
 *  is removed if the row write fails). */
export async function fileInvoicePdf(input: {
  matterId: string;
  invoiceId: string;
  invoiceNumber: string;
  kind: InvoiceEmailKind | "void";
  bytes: Buffer;
  userId: string;
  day: Date;
}): Promise<{ documentId: string }> {
  const name = `Invoice ${input.invoiceNumber} (${KIND_WORD[input.kind]} ${dateOnlyKey(input.day)}).pdf`;
  const folderId = await invoicesFolder(input.matterId);
  const stored = await storeFile(
    new File([new Uint8Array(input.bytes)], name, { type: "application/pdf" })
  );
  try {
    const doc = await prisma.document.create({
      data: {
        matterId: input.matterId,
        invoiceId: input.invoiceId,
        folderId,
        name,
        category: "correspondence",
        source: "invoice",
        fileUrl: stored.key,
        contentType: "application/pdf",
        fileSize: stored.size,
        uploadedBy: input.userId,
      },
      select: { id: true },
    });
    return { documentId: doc.id };
  } catch (err) {
    await deleteFile(stored.key).catch(() => undefined);
    throw err;
  }
}
