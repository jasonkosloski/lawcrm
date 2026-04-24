import { SettingsPlaceholder } from "@/components/settings/settings-placeholder";

export default function BillingSettingsPage() {
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
