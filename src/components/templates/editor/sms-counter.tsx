"use client";

/** "n characters · m segments" under the text-message editor. */

import { useMemo } from "react";
import type { AppliesTo, TemplateDoc } from "@/lib/templates/schema";
import { smsCountLabel, smsStats, smsTextWithSamples } from "./sms-count";

export function SmsCounter({ doc, appliesTo }: { doc: TemplateDoc; appliesTo: AppliesTo }) {
  const label = useMemo(
    () =>
      smsCountLabel(smsStats(smsTextWithSamples(doc, appliesTo === "lead" ? "lead" : "matter"))),
    [doc, appliesTo],
  );
  return (
    <div className="flex items-center gap-2 text-2xs">
      <span className="font-mono text-ink-3">{label}</span>
      <span className="text-ink-4">Counted with sample values</span>
    </div>
  );
}
