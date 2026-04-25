import { TabPlaceholder } from "@/components/matters/tab-placeholder";

export default function MatterBillingPage() {
  return (
    <TabPlaceholder
      title="Billing"
      description="Work-in-progress, invoices, trust ledger, and (for personal-injury matters) the settlement distribution waterfall — all in one place per matter."
      expectedItems={[
        "WIP summary (unbilled time + expenses) with one-click 'create invoice from these'",
        "Invoice list with status (draft / sent / paid / overdue), totals, and payment history",
        "Trust ledger: deposits, withdrawals, current IOLTA balance, reconciliation",
        "Settlement distribution: gross → fees → costs → liens → client net waterfall",
        "Lien tracking and approval workflow",
        "Aging report (30/60/90 days)",
        "Time entries and expenses can be marked billed in bulk from this view",
      ]}
      blockedBy="Phase 6 — Billing & Trust"
    />
  );
}
