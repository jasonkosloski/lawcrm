"use client";

/**
 * Venue picker for the matter forms. Type to filter; with `canAdd`, press
 * Enter on a name that matches nothing to add it inline (small popover with
 * name / state / city / county). The visible text box never posts: only the
 * hidden `<input name={name}>` carries the selected venue id, and typing
 * clears the selection so free text can't masquerade as a venue.
 */

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createVenue } from "@/app/actions/venues";
import type { VenueOption } from "@/lib/queries/venues";
import { inputCls } from "./form-primitives";

export function venueLabel(v: VenueOption): string {
  const place = [v.city, v.county, v.state].filter(Boolean).join(", ");
  return place ? `${v.name} · ${place}` : v.name;
}

/** Input text for a selected venue; an archived one says so. */
function inputText(v: VenueOption): string {
  return v.isActive ? v.name : `${v.name} (archived)`;
}

const ADD_VALUE = "__add_venue__";

type Props = {
  name: string;
  venues: VenueOption[];
  value: string | null;
  onChange: (v: VenueOption | null) => void;
  canAdd: boolean;
  defaultState: string;
  error?: string;
  required?: boolean;
};

export function VenueCombobox({
  name,
  venues,
  value,
  onChange,
  canAdd,
  defaultState,
  error,
  required,
}: Props) {
  const [added, setAdded] = useState<VenueOption[]>([]);
  const all = [...venues, ...added.filter((a) => !venues.some((v) => v.id === a.id))];
  const current = value ? (all.find((v) => v.id === value) ?? null) : null;

  const [text, setText] = useState(current ? inputText(current) : "");
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (current) setText(inputText(current));
  }
  const [listOpen, setListOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", state: "", city: "", county: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const listId = useId();

  const query = text.trim().toLowerCase();
  const filtering = !current && query.length > 0;
  const shown = all.filter((v) => {
    if (!v.isActive && v.id !== value) return false;
    if (!filtering) return true;
    return [v.name, v.city, v.county].some((p) => p?.toLowerCase().includes(query));
  });
  const exact = all.some((v) => v.name.trim().toLowerCase() === query);
  const showAdd = canAdd && query.length > 0 && !exact && !current;
  const showNoMatch = !canAdd && filtering && shown.length === 0;

  function pick(v: VenueOption) {
    setText(inputText(v));
    setListOpen(false);
    onChange(v);
  }

  function openAdd() {
    setDraft({ name: text.trim(), state: defaultState, city: "", county: "" });
    setFormError(null);
    setFieldErrors({});
    setListOpen(false);
    setAddOpen(true);
  }

  async function save() {
    if (saving) return;
    if (!draft.state.trim()) {
      setFieldErrors({ state: ["State is required."] });
      return;
    }
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const res = await createVenue({
        name: draft.name,
        state: draft.state,
        city: draft.city || undefined,
        county: draft.county || undefined,
      });
      if (res.ok || res.code === "exists") {
        setAdded((a) => [...a, res.venue]);
        setAddOpen(false);
        pick(res.venue);
      } else if (res.code === "archived") {
        setFormError(
          `"${draft.name.trim()}" is archived. Restore it in Settings → Venues.`
        );
      } else {
        setFieldErrors(res.errors);
      }
    } finally {
      setSaving(false);
    }
  }

  const fieldCls = inputCls(false);
  const err = (k: string) =>
    fieldErrors[k]?.[0] ? (
      <div className="text-2xs text-warn">{fieldErrors[k][0]}</div>
    ) : null;

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setListOpen(false);
        }
      }}
    >
      <input type="hidden" name={name} value={value ?? ""} />
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger
          nativeButton={false}
          render={<span aria-hidden className="absolute left-0 top-full h-0 w-full" />}
        />
        <Command shouldFilter={false} className="overflow-visible bg-transparent p-0">
          <CommandInput
            value={text}
            role="combobox"
            aria-expanded={listOpen}
            aria-label="Venue"
            aria-invalid={!!error}
            aria-required={required}
            placeholder="Search or add a venue"
            onFocus={() => setListOpen(true)}
            onValueChange={(t) => {
              setText(t);
              setListOpen(true);
              if (value) onChange(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setListOpen(false);
              if (e.key === "Enter" && !listOpen) e.preventDefault();
            }}
          />
          {listOpen && (
            <CommandList
              id={listId}
              aria-label="Venues"
              className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 rounded-md border border-line bg-white shadow-md py-1"
            >
              {shown.map((v) => (
                <CommandItem
                  key={v.id}
                  value={v.id}
                  onSelect={() => pick(v)}
                  className="text-xs"
                >
                  {venueLabel(v)}
                  {!v.isActive ? " (archived)" : ""}
                </CommandItem>
              ))}
              {showAdd && (
                <CommandItem
                  value={ADD_VALUE}
                  onSelect={openAdd}
                  className="text-xs"
                >
                  <Plus size={12} />
                  Press Enter to add &quot;{text.trim()}&quot;
                </CommandItem>
              )}
              {showNoMatch && (
                <div className="px-2.5 py-1.5 text-xs text-ink-4">
                  No venue matches. Ask an admin to add it.
                </div>
              )}
            </CommandList>
          )}
        </Command>
        <PopoverContent
          align="start"
          className="w-[calc(100vw-2rem)] sm:w-80 bg-white"
          initialFocus
        >
          <div
            className="flex flex-col gap-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
          >
            <label className="flex flex-col gap-0.5 text-2xs text-ink-3">
              Name
              <input
                className={fieldCls}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              {err("name")}
            </label>
            <label className="flex flex-col gap-0.5 text-2xs text-ink-3">
              State
              <input
                className={fieldCls}
                value={draft.state}
                onChange={(e) => setDraft({ ...draft, state: e.target.value })}
              />
              {err("state")}
            </label>
            <label className="flex flex-col gap-0.5 text-2xs text-ink-3">
              City
              <input
                className={fieldCls}
                value={draft.city}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              />
              {err("city")}
            </label>
            <label className="flex flex-col gap-0.5 text-2xs text-ink-3">
              County
              <input
                className={fieldCls}
                value={draft.county}
                onChange={(e) => setDraft({ ...draft, county: e.target.value })}
              />
              {err("county")}
            </label>
            {formError && (
              <div role="alert" className="text-2xs text-warn">
                {formError}
              </div>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="self-end rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Save venue
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {error && <div className="text-2xs text-warn mt-1">{error}</div>}
    </div>
  );
}
