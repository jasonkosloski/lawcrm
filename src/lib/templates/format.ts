/**
 * Value formatting for template fields. Pure and client-safe.
 * The catalog (catalog.ts) stays declarative; every formatting rule
 * lives here.
 */

import { formatDate } from "@/lib/format-date";
import type { CatalogField, FieldFormat, FieldValue } from "./catalog";

export type ListJoin = "and" | "oxford_and" | "lines";

/** Split a stored single `name` on the last space. A single word is
 *  both first and last. */
export function splitName(name: string): { first: string; last: string } {
  const t = name.trim().replace(/\s+/g, " ");
  const i = t.lastIndexOf(" ");
  if (i < 0) return { first: t, last: t };
  return { first: t.slice(0, i), last: t.slice(i + 1) };
}

/** "A and B", "A, B and C" (and) / "A, B, and C" (oxford_and), or one
 *  per line. */
export function joinList(items: string[], join: ListJoin): string {
  if (join === "lines") return items.join("\n");
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, -1).join(", ");
  const last = items[items.length - 1];
  return join === "oxford_and" ? `${head}, and ${last}` : `${head} and ${last}`;
}

function formatDateValue(
  d: Date,
  format: FieldFormat | null,
  dateOnly: boolean,
  tz: string | null,
): string {
  // Date-only values are UTC-midnight calendar dates (ADR-012): read
  // them on the UTC grid, never shift into the user's zone.
  const zone = dateOnly ? "UTC" : tz;
  switch (format) {
    case "iso":
      return formatDate(d, "iso", "UTC");
    case "short":
      return d.toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        ...(zone ? { timeZone: zone } : {}),
      });
    case "full":
      return formatDate(d, "full", zone);
    default:
      return formatDate(d, "long", zone);
  }
}

/** Format a catalog value for output. Null (or blank) means "not on
 *  file" so the caller can render the visible placeholder. */
export function formatFieldValue(
  field: CatalogField,
  value: FieldValue,
  format: FieldFormat | null,
  tz: string | null,
): string | null {
  if (value === null || value === undefined) return null;
  const fmt = format ?? field.defaultFormat;

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (value instanceof Date) {
    return formatDateValue(value, fmt, field.dateOnly === true, tz);
  }

  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    return fmt === "upper" ? t.toUpperCase() : t;
  }

  if ("lines" in value) {
    const lines = value.lines.map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    return fmt === "block" ? lines.join("\n") : lines.join(", ");
  }

  // PersonValue
  const name = value.name.trim();
  if (!name) return null;
  if (value.isOrganization) return name;
  if (fmt === "first") return splitName(name).first;
  if (fmt === "last") return splitName(name).last;
  return name;
}
