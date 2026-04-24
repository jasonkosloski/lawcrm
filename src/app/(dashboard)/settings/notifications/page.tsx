import { SettingsPlaceholder } from "@/components/settings/settings-placeholder";

export default function NotificationsSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Notifications"
      description="Pick which events ping you and where delivery happens (in-app, email, SMS)."
      expectedItems={[
        "Channel toggles per category (in-app, email, SMS)",
        "Categories: filings, opposing-counsel emails, deadlines, tasks, settlement approvals",
        "Per-matter mute/unmute for noisy cases",
        "Quiet hours window",
      ]}
      blockedBy="Phase 8 Notifications system"
    />
  );
}
