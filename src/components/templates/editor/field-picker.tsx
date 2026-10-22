/**
 * Field picker: a search box over the catalog fields that fit the
 * template, grouped in FIELD_GROUPS order, each entry showing its value
 * in the current preview data. Inside a repeat, the list's item fields
 * come first; "Lists" offers whole-list fields (joined names, etc.).
 */

"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import {
  FIELD_GROUPS,
  listByPath,
  type CatalogField,
  type CatalogList,
  type ListItem,
  type TemplateData,
} from "@/lib/templates/catalog";
import { formatFieldValue, joinList } from "@/lib/templates/format";
import type { JoinStyle } from "@/lib/templates/schema";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Entry = { id: string; label: string; example: string | null; pick: () => void };
type Group = { title: string; entries: Entry[] };

/** One-line example value of a field in `data` (item fields read `item`). */
export function exampleValue(
  field: CatalogField,
  data: TemplateData,
  item?: ListItem,
): string | null {
  try {
    const v = formatFieldValue(field, field.get(data, item), null, data.timeZone);
    return v ? v.replace(/\s*\n\s*/g, ", ") : null;
  } catch {
    return null;
  }
}

export function FieldPicker({
  fields,
  lists,
  repeatList,
  data,
  onPickField,
  onPickListField,
}: {
  fields: CatalogField[];
  lists: CatalogList[];
  /** The enclosing repeat's list at the cursor, if any. */
  repeatList: string | null;
  data: TemplateData;
  onPickField: (path: string) => void;
  onPickListField?: (attrs: { list: string; itemPath: string; join: JoinStyle }) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (e: Entry) => !q || e.label.toLowerCase().includes(q);

  const groups: Group[] = [];
  const repeat = repeatList ? listByPath(repeatList) : undefined;
  if (repeat) {
    const item = repeat.get(data)[0];
    groups.push({
      title: `Each ${repeat.label.toLowerCase()}`,
      entries: repeat.itemFields.map((f) => ({
        id: `item.${f.path}`,
        label: f.label,
        example: exampleValue(f, data, item),
        pick: () => onPickField(`item.${f.path}`),
      })),
    });
  }
  for (const g of FIELD_GROUPS) {
    const entries = fields
      .filter((f) => f.group === g)
      .map((f) => ({
        id: f.path,
        label: f.label,
        example: exampleValue(f, data),
        pick: () => onPickField(f.path),
      }));
    if (entries.length) groups.push({ title: g, entries });
  }
  if (onPickListField) {
    const entries = lists.flatMap((l) => {
      const items = l.get(data);
      return l.itemFields.map((f) => ({
        id: `${l.path}:${f.path}`,
        label: `${l.label}: ${f.label}`,
        example: joinList(
          items.map((i) => exampleValue(f, data, i)).filter((x): x is string => !!x),
          "and",
        ),
        pick: () => onPickListField({ list: l.path, itemPath: f.path, join: "and" }),
      }));
    });
    if (entries.length) groups.push({ title: "Lists", entries });
  }

  const shown = groups
    .map((g) => ({ ...g, entries: g.entries.filter(matches) }))
    .filter((g) => g.entries.length > 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          size={12}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
          aria-hidden="true"
        />
        <input
          autoFocus
          aria-label="Search fields"
          placeholder="Search fields"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(inputClass(false, "sm"), "w-full pl-7")}
        />
      </div>
      <div className="max-h-80 overflow-y-auto -mx-1">
        {shown.length === 0 && <p className="px-2 py-3 text-xs text-ink-4">No fields match.</p>}
        {shown.map((g) => (
          <div key={g.title} className="mb-1.5">
            <div className="px-2 py-1 text-2xs font-medium text-ink-4">{g.title}</div>
            {g.entries.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={e.pick}
                className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-1 text-left text-xs hover:bg-paper-2"
              >
                <span className="text-ink-2 shrink-0">{e.label}</span>
                <span className="truncate text-2xs text-ink-4">{e.example ?? "—"}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
