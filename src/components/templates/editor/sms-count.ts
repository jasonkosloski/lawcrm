/**
 * SMS length and segment count for the text-message template editor.
 * GSM-7 text fits 160 characters in one segment and 153 per segment once
 * split; any character outside GSM-7 forces UCS-2 (70 single, 67 split).
 * Extension-table characters (€, [, ] …) take two GSM slots.
 */

import { SAMPLE_TEMPLATE_DATA, type Scope } from "@/lib/templates/catalog";
import { renderTemplate } from "@/lib/templates/render";
import type { TemplateDoc } from "@/lib/templates/schema";
import { resolvedToText } from "@/lib/templates/to-text";
import { plural } from "@/lib/utils";

const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENSION = new Set("^{}\\[~]|€\f");

export type SmsStats = { characters: number; segments: number };

export function smsStats(text: string): SmsStats {
  const chars = [...text];
  if (chars.length === 0) return { characters: 0, segments: 0 };
  const gsm = chars.every((c) => GSM_BASIC.has(c) || GSM_EXTENSION.has(c));
  if (gsm) {
    const units = chars.reduce((n, c) => n + (GSM_EXTENSION.has(c) ? 2 : 1), 0);
    return { characters: chars.length, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  // UCS-2 counts UTF-16 code units (an emoji takes two).
  const units = text.length;
  return { characters: chars.length, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

export function smsCountLabel(s: SmsStats): string {
  return `${plural(s.characters, "character")} · ${plural(s.segments, "segment")}`;
}

/** The message as it would be sent with sample data: each field counts
 *  as its sample value's length. */
export function smsTextWithSamples(doc: TemplateDoc, scope: Scope): string {
  const { doc: resolved } = renderTemplate(doc, {
    data: { ...SAMPLE_TEMPLATE_DATA, scope },
    blocks: new Map(),
  });
  return resolvedToText(resolved);
}
