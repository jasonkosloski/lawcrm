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
