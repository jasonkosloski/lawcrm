import { SettingsPlaceholder } from "@/components/settings/settings-placeholder";

export default function SecuritySettingsPage() {
  return (
    <SettingsPlaceholder
      title="Security"
      description="Sign-in, sessions, and account access controls."
      expectedItems={[
        "Change password",
        "Two-factor authentication (TOTP / WebAuthn)",
        "Active sessions and sign-out from each device",
        "Recent sign-in history",
      ]}
      blockedBy="Phase 9 Authentication"
    />
  );
}
