import { SettingsPlaceholder } from "@/components/settings/settings-placeholder";
import { requireAdmin } from "@/lib/firm";

export default async function IntegrationsSettingsPage() {
  await requireAdmin();
  return (
    <SettingsPlaceholder
      title="Integrations"
      description="Third-party services connected to the firm."
      expectedItems={[
        "Gmail (per-user OAuth for email sync)",
        "Google Calendar (per-user OAuth for event sync)",
        "Westlaw / research tools",
        "E-signature (DocuSign or similar)",
        "IOLTA trust account bank feed",
        "PACER / court filing integrations",
      ]}
      blockedBy="Each integration gets wired as its underlying feature lands (Email, Calendar, Billing, etc.)"
    />
  );
}
