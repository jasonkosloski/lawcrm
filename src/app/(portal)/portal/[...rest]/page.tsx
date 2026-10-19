/**
 * Any unmatched portal path. Without this, Next sends unmatched URLs to the
 * STAFF root not-found. Signed-out clients go to /login (the guard); signed-in
 * ones get the portal 404 (`../not-found.tsx`).
 */

import { notFound } from "next/navigation";
import { requirePortalIdentity } from "@/lib/portal-access";

export default async function PortalCatchAll(): Promise<never> {
  await requirePortalIdentity();
  notFound();
}
