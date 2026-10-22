import { logActivity } from "@/lib/activity-log";

/** Firm-scope audit entry (no matter) for template and block library
 *  changes — a rewritten or deleted template changes every future
 *  letter. Lives outside the "use server" action files so it is not
 *  exposed as a callable action. */
export async function logTemplateChange(
  userId: string,
  title: string,
  detail: string | null,
): Promise<void> {
  await logActivity({
    matterId: null,
    userId,
    type: "document",
    title,
    detail,
    source: "Settings",
  });
}
