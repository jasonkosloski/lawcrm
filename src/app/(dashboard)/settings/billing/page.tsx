import { SettingsPlaceholder } from "@/components/settings/settings-placeholder";
import { requirePermission } from "@/lib/permission-check";

export default async function BillingSettingsPage() {
  // Placeholder; gated on firm.edit_info until billing settings
  // grow their own permission keys when the feature lands.
  await requirePermission("firm.edit_info");
  return (
    <SettingsPlaceholder
      title="Billing & rates"
      description="Default billing rates, invoice templates, and activity code mappings."
      expectedItems={[
        "Default hourly rate per user",
        "UTBMS activity code library and firm-wide preferred codes",
        "Invoice template (layout, logo, footer text)",
        "Default payment terms (net 30, etc.)",
        "Tax settings for jurisdictions that require it",
      ]}
      blockedBy="Phase 6 Billing"
    />
  );
}
