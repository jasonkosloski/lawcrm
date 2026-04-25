import { TabPlaceholder } from "@/components/matters/tab-placeholder";

export default function MatterTimelinePage() {
  return (
    <TabPlaceholder
      title="Timeline"
      description="A unified, chronological feed of everything that happens on this matter — every email, filing, deadline, deposition, settlement movement, and team note in one stream."
      expectedItems={[
        "Aggregated event stream from filings, emails, deadlines, calendar events, time entries, notes, and document uploads",
        "Filter pills (filings only / communication / deadlines / financial / notes)",
        "Date-range scrubber for jumping to a specific week or month",
        "Inline expand for long entries (full email body, full note text)",
        "Pin / star important moments so they surface to the matter Overview",
        "Export to PDF for case-history reports",
      ]}
      blockedBy="Phase 2 — Matter Detail · Timeline tab build-out"
    />
  );
}
