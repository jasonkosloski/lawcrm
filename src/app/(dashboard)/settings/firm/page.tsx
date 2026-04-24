import { SettingsPlaceholder } from "@/components/settings/settings-placeholder";

export default function FirmSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Firm info"
      description="Firm identity, defaults, and document branding."
      expectedItems={[
        "Firm name, address, phone, bar affiliations",
        "Firm logo (for invoices, letterhead, shared docs)",
        "Default practice areas shown in new matter form",
        "Default fee structure, trust account",
        "Matter numbering scheme",
      ]}
    />
  );
}
