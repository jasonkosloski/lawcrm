/**
 * Settings Index — redirects to the Profile section.
 *
 * The settings landing page has nothing meaningful of its own; sending
 * the user straight to the first real section avoids a blank state.
 */

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/current-user";

export default async function SettingsIndexPage() {
  await requireUser();
  redirect("/settings/profile");
}
