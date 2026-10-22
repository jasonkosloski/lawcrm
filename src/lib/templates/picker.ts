/**
 * Where-clause for the "Generate from template" pickers: active letters and
 * filings that fit the record's scope (email/SMS never generate files).
 */
export function generatableTemplateWhere(scopeKind: "matter" | "lead") {
  return {
    isActive: true,
    kind: { in: ["letter", "filing"] },
    appliesTo: { in: scopeKind === "lead" ? ["lead", "both"] : ["matter", "both"] },
  };
}

/** Where-clause for the email / text template pickers: active templates
 *  of that kind that fit the record's scope. */
export function messageTemplateWhere(kind: "email" | "sms", scopeKind: "matter" | "lead") {
  return {
    isActive: true,
    kind,
    appliesTo: { in: scopeKind === "lead" ? ["lead", "both"] : ["matter", "both"] },
  };
}
