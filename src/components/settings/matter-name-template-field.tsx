/**
 * Matter-name template input with a token reference and a live preview
 * rendered against fixed sample values. Parse errors show inline; the
 * server re-validates on save. A blank value previews `placeholder`
 * (the inherited firm template) when one is given.
 */

"use client";

import { useState } from "react";
import {
  DEFAULT_MATTER_NAME_TEMPLATE,
  parseTemplate,
  renderMatterName,
} from "@/lib/matter-name-template";
import { Field, inputClass } from "@/components/ui/field";

const TOKEN_HELP: { token: string; meaning: string }[] = [
  { token: "client_first", meaning: "client first name" },
  { token: "client_last", meaning: "client last name" },
  { token: "client_full", meaning: "client full name" },
  { token: "case_number", meaning: "case number" },
  { token: "location", meaning: "venue name" },
  { token: "county", meaning: "venue county" },
  { token: "state", meaning: "venue state" },
  { token: "opposing_party", meaning: "opposing party" },
  { token: "practice_area", meaning: "practice area" },
  { token: "year", meaning: "year opened" },
];

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function MatterNameTemplateField({
  name = "matterNameTemplate",
  defaultValue,
  placeholder,
  practiceAreaName = "Civil Rights",
  label = "Matter name template",
  hint,
  error,
}: {
  name?: string;
  defaultValue: string;
  placeholder?: string;
  practiceAreaName?: string;
  label?: string;
  hint?: string;
  error?: string[];
}) {
  const [value, setValue] = useState(defaultValue);
  const effective = value.trim() === "" && placeholder !== undefined ? placeholder : value;
  const parsed = parseTemplate(effective);
  const id = `${name}-field`;

  let preview: string | null = null;
  if (parsed.ok) {
    preview = renderMatterName(effective, {
      clientName: "Maria Alvarez",
      caseNumber: "2026-CV-00481",
      venue: { name: "Aurora", county: "Arapahoe", state: "CO" },
      opposingParty: "City of Aurora",
      practiceAreaName,
      now: new Date(),
      timeZone: browserZone(),
    });
  }

  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <input
        id={id}
        name={name}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? DEFAULT_MATTER_NAME_TEMPLATE}
        className={inputClass(!!error?.length || !parsed.ok) + " font-mono"}
      />
      {!parsed.ok ? (
        <div className="text-2xs text-warn" role="alert">
          {parsed.error}
        </div>
      ) : (
        <div className="text-2xs text-ink-3">
          Preview: <span data-testid="template-preview">{preview}</span>
        </div>
      )}
      <details className="text-2xs text-ink-4">
        <summary className="cursor-pointer">Available tokens</summary>
        <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          {TOKEN_HELP.map((t) => (
            <li key={t.token}>
              <code className="font-mono text-ink-3">{`{${t.token}}`}</code> {t.meaning}
            </li>
          ))}
        </ul>
      </details>
    </Field>
  );
}
