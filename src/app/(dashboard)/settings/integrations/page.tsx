import { SettingsPlaceholder } from "@/components/settings/settings-placeholder";
import { requirePermission } from "@/lib/permission-check";

export default async function IntegrationsSettingsPage() {
  // Placeholder page; gated on firm.edit_info as a stand-in until
  // each integration grows its own permission key when it lands.
  await requirePermission("firm.edit_info");
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
