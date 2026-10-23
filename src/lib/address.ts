/** Postal address formatting shared by templates and record pages. */

/** "Denver, CO 80202" from whatever parts exist; null when none do. */
export function cityStateZip(
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): string | null {
  const locality = [city?.trim(), state?.trim()].filter(Boolean).join(", ");
  return [locality, zip?.trim()].filter(Boolean).join(" ") || null;
}

/** An address's printed lines (street lines, then city/state/zip),
 *  blank parts dropped. */
export function addressLines(a: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string[] {
  return [a.addressLine1, a.addressLine2, cityStateZip(a.city, a.state, a.zip)]
    .map((x) => x?.trim() ?? "")
    .filter(Boolean);
}
