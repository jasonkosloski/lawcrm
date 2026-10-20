/**
 * Edit a matter's originating-document (fee agreement) record: status,
 * signed date and the linked document. Gated on `matters.agreement.edit`
 * plus matter access. When the firm requires a signed originating
 * document, the saved result must pass the same gate as opening a matter.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { assertMatterAccess } from "@/lib/matter-access";
import { logActivity } from "@/lib/activity-log";
import { dateOnlyKey, parseDateOnly } from "@/lib/format-date";
import { agreementGateErrors, originatingDocLabel } from "@/lib/originating-doc";
import { todayDateOnly } from "@/app/actions/billing/helpers";

export type AgreementFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
};

const STATUS_LABEL: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  signed: "Signed",
};

export async function updateMatterAgreement(
  matterId: string,
  _prev: AgreementFormState,
  fd: FormData
): Promise<AgreementFormState> {
  const userId = await requirePermission("matters.agreement.edit");
  await assertMatterAccess(matterId);

  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const status = str("status");
  const signedDate = str("signedDate");
  const documentId = str("documentId");

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: {
      practiceArea: { select: { originatingDocLabel: true } },
      agreement: { select: { status: true, signedDate: true, documentId: true } },
    },
  });
  if (!matter) return { status: "error", errors: { _form: ["Matter not found."] } };

  if (documentId) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, matterId, status: { not: "archived" } },
      select: { id: true },
    });
    if (!doc) {
      return {
        status: "error",
        errors: { documentId: ["Choose a document on this matter."] },
      };
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firm: { select: { requireOriginatingDoc: true } } },
  });
  const label = originatingDocLabel(matter.practiceArea);
  const gate = agreementGateErrors(
    { status, signedDate, hasOriginatingFile: documentId !== "" },
    {
      required: user?.firm?.requireOriginatingDoc ?? false,
      label,
      today: dateOnlyKey(await todayDateOnly()),
    }
  );
  if (Object.keys(gate).length > 0) {
    const errors: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(gate)) {
      errors[k === "originatingFileId" ? "documentId" : k] = [v as string];
    }
    return { status: "error", errors };
  }

  const newStatus = status || "not_sent";
  const newSigned = signedDate ? parseDateOnly(signedDate) : null;
  const newDoc = documentId || null;
  await prisma.matterAgreement.upsert({
    where: { matterId },
    create: { matterId, status: newStatus, signedDate: newSigned, documentId: newDoc },
    update: { status: newStatus, signedDate: newSigned, documentId: newDoc },
  });

  const old = matter.agreement;
  const oldSigned = old?.signedDate ? dateOnlyKey(old.signedDate) : "";
  const parts: string[] = [];
  if ((old?.status ?? "not_sent") !== newStatus) {
    parts.push(
      `Status ${STATUS_LABEL[old?.status ?? "not_sent"] ?? old?.status} → ${STATUS_LABEL[newStatus]}`
    );
  }
  if (oldSigned !== signedDate) {
    parts.push(`Signed date ${oldSigned || "none"} → ${signedDate || "none"}`);
  }
  if ((old?.documentId ?? null) !== newDoc) {
    parts.push(newDoc ? "Document linked" : "Document unlinked");
  }
  if (parts.length > 0) {
    await logActivity({
      matterId,
      userId,
      type: "document",
      title: `Updated ${label.toLowerCase()} record`,
      detail: parts.join("; "),
    });
  }

  revalidatePath(`/matters/${matterId}`, "layout");
  return { status: "ok" };
}
