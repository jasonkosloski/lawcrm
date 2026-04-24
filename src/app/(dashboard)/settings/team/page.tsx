import { SettingsPlaceholder } from "@/components/settings/settings-placeholder";

export default function TeamSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Team"
      description="Firm members, roles, and access levels."
      expectedItems={[
        "User roster with role (Managing / Partner / Counsel / Paralegal / Investigator / Intake / Admin)",
        "Invite new team member (email + role)",
        "Deactivate / reactivate users",
        "Role-based access control configuration",
      ]}
      blockedBy="Phase 8 Team management + Phase 9 Authentication"
    />
  );
}
