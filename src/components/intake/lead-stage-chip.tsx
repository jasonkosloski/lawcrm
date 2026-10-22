import { LEAD_STAGE_LABEL } from "@/lib/constants/lead-stage";

/** Lead stage as a pill: brand for new, green for converted, grey otherwise. */
export function LeadStageChip({ stage }: { stage: string }) {
  // DB stage values arrive untyped — fall back to the raw slug
  // for anything the label map doesn't know.
  const label = (LEAD_STAGE_LABEL as Record<string, string>)[stage] ?? stage;
  const cls =
    stage === "new"
      ? "bg-brand-soft text-brand-700"
      : stage === "converted"
        ? "bg-ok-soft text-ok"
        : "bg-paper-2 text-ink-3";
  return (
    <span className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}
