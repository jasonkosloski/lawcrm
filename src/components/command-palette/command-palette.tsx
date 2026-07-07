/**
 * Command Palette UI
 *
 * Full-text ⌘K palette. Fetches all searchable entities on open, then
 * lets cmdk filter/rank in-memory. Three passes:
 *
 * 1. Contextual actions (shown only when relevant, e.g. on a matter page)
 * 2. Pinned + recent (empty-query state)
 * 3. Everything — matters, people, leads, navigation + create-new
 *    actions (search-query state)
 *
 * Scoping prefixes (v2): `#` matters, `@` people (contacts, users,
 * leads), `>` actions (navigation + create-new + contextual). Parsed
 * by parsePaletteQuery (./prefix.ts); enforced in the custom cmdk
 * filter via per-item kind tags baked into each CommandItem value.
 * Bare queries behave exactly as before.
 *
 * Plus a permanent last row once the (prefix-stripped) term is ≥2
 * chars: "Search everywhere for …" → /search?q= (full-text content
 * search — the palette itself only jumps to entities it preloaded).
 * A #/@ scope narrows it via /search's ?type= group filter; under
 * `>` the row hides (actions aren't full-text-searchable). It scores
 * lowest in the cmdk ranking, so Enter prefers real jump-to hits
 * and falls through to full-text search when nothing matches.
 *
 * Selection → navigate (`router.push`) or invoke server action (pin).
 * Pinned/recent selections get pushed to localStorage so next open
 * remembers you.
 */

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  BarChart3,
  Briefcase,
  Calendar,
  CalendarPlus,
  Clock,
  DollarSign,
  FilePlus2,
  Gavel,
  Home,
  Inbox,
  ListPlus,
  Mail,
  Pin,
  PinOff,
  Search,
  Settings,
  User,
  UserSquare,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  getPaletteData,
  type PaletteData,
  type PaletteItem,
  type PaletteMatter,
} from "@/lib/queries/command-palette";
import { NAV_DESTINATIONS } from "@/lib/command-palette/destinations";
import {
  pushRecent,
  readRecents,
  type RecentRef,
} from "@/lib/command-palette/recents";
import { toggleMatterPin } from "@/app/actions/matter-pins";
import {
  parsePaletteQuery,
  paletteValue,
  scopeAllowsKind,
  splitPaletteValue,
  SCOPE_SEARCH_TYPE,
} from "./prefix";
import { CREATE_ACTIONS, CREATE_NAV_IDS } from "./create-actions";

const ICON_MAP: Record<string, LucideIcon> = {
  home: Home,
  gavel: Gavel,
  pin: Pin,
  inbox: Inbox,
  mail: Mail,
  calendar: Calendar,
  clock: Clock,
  dollar: DollarSign,
  chart: BarChart3,
  zap: Zap,
  settings: Settings,
  user: User,
  userSquare: UserSquare,
  briefcase: Briefcase,
  filePlus: FilePlus2,
  calendarPlus: CalendarPlus,
  inboxPlus: ListPlus,
};

/** Navigation group, minus destinations re-homed to the Create group. */
const NAV_ROWS = NAV_DESTINATIONS.filter((d) => !CREATE_NAV_IDS.has(d.id));

/** Create group: "New matter" first, then the pre-existing "New
 *  contact" nav destination, then the rest (event, intake/lead). */
const CREATE_ROWS = [
  ...CREATE_ACTIONS.slice(0, 1),
  ...NAV_DESTINATIONS.filter((d) => CREATE_NAV_IDS.has(d.id)),
  ...CREATE_ACTIONS.slice(1),
];

/** Sentinel `value` for the "Search everywhere" row. The custom
 *  filter special-cases it to a tiny positive score so the row is
 *  always visible (never filtered out) but always sorts LAST —
 *  cmdk orders by score, so jump-to hits keep first-Enter priority
 *  and this row is the Enter target only when nothing else matches. */
const SEARCH_EVERYWHERE_VALUE = "__search-everywhere__";

/** Mirrors SEARCH_MIN_QUERY_LENGTH in src/lib/queries/search.ts.
 *  Kept as a local literal because importing the query module here
 *  would pull Prisma into the client bundle. */
const SEARCH_MIN_QUERY_LENGTH = 2;

const CONTACT_TYPE_LABEL: Record<string, string> = {
  client: "Client",
  opposing_counsel: "Opposing",
  witness: "Witness",
  expert: "Expert",
  judge: "Judge",
  court: "Court",
  vendor: "Vendor",
  medical_provider: "Medical",
  government: "Government",
  other: "Contact",
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const [data, setData] = useState<PaletteData | null>(null);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<RecentRef[]>([]);

  // Fetch fresh data + load recents each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRecents(readRecents());
    let cancelled = false;
    getPaletteData()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        // A failed fetch (expired session, network blip) must not strand
        // the palette on "Loading…" — fall back to empty data so the
        // static navigation destinations stay usable. Reopening retries.
        console.warn("[command-palette] fetch failed", err);
        if (!cancelled) setData({ items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Extract current matter id from pathname (contextual pin action).
  const currentMatterId = useMemo(() => {
    const m = /^\/matters\/([a-z0-9]{20,})/.exec(pathname);
    return m?.[1] ?? null;
  }, [pathname]);

  const currentMatter: PaletteMatter | null = useMemo(() => {
    if (!currentMatterId || !data) return null;
    const found = data.items.find(
      (i): i is PaletteMatter => i.kind === "matter" && i.id === currentMatterId
    );
    return found ?? null;
  }, [currentMatterId, data]);

  const close = () => onOpenChange(false);

  const go = (href: string, recent: RecentRef) => {
    pushRecent(recent);
    close();
    router.push(href);
  };

  // Scope prefix (#/@/>) parsed once per keystroke; `term` is the
  // query with the prefix stripped — what matching + /search use.
  const parsed = useMemo(() => parsePaletteQuery(query), [query]);

  // Full-text escape hatch: the palette only jumps to entities it
  // preloaded; content questions route to /search. Selected via
  // click or Enter (when it's the top — i.e. only — match). A scope
  // prefix carries through as /search's ?type= group filter
  // (#foo → matters full-text, @foo → contacts); the row hides
  // entirely under `>` since actions aren't full-text-searchable.
  const searchType = parsed.scope ? SCOPE_SEARCH_TYPE[parsed.scope] : null;
  const searchRowVisible =
    parsed.term.length >= SEARCH_MIN_QUERY_LENGTH &&
    (parsed.scope === null || searchType !== null);
  const searchEverywhere = () => {
    if (!searchRowVisible) return;
    close();
    router.push(
      `/search?q=${encodeURIComponent(parsed.term)}${
        searchType ? `&type=${searchType}` : ""
      }`
    );
  };

  const toggleCurrentPin = () => {
    if (!currentMatter) return;
    const matterId = currentMatter.id;
    close();
    startTransition(async () => {
      await toggleMatterPin(matterId);
    });
  };

  // ── Build the sections ────────────────────────────────────────────────
  const matters =
    data?.items.filter((i): i is PaletteMatter => i.kind === "matter") ?? [];
  const pinnedMatters = matters.filter((m) => m.isPinned);

  // Recents — resolved from current data (skip any that no longer exist).
  const resolvedRecents = recents
    .map((ref): { ref: RecentRef; item: PaletteItem | null; nav: (typeof NAV_DESTINATIONS)[number] | null } | null => {
      if (ref.kind === "nav") {
        // Create-new actions store nav-kind refs too ("create:…" ids).
        const nav =
          NAV_DESTINATIONS.find((n) => n.id === ref.id) ??
          CREATE_ACTIONS.find((n) => n.id === ref.id) ??
          null;
        return nav ? { ref, item: null, nav } : null;
      }
      const item =
        data?.items.find(
          (i) => i.kind === ref.kind && i.id === ref.id
        ) ?? null;
      return item ? { ref, item, nav: null } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 5);

  const contacts = data?.items.filter((i) => i.kind === "contact") ?? [];
  const leads = data?.items.filter((i) => i.kind === "lead") ?? [];
  const users = data?.items.filter((i) => i.kind === "user") ?? [];

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search matters, contacts, leads, and firm actions. Press ↵ to select, esc to close."
      className="sm:max-w-2xl"
    >
      <Command
        label="Command palette"
        filter={(value, search) => {
          // "Search everywhere" always shows (its render is gated on
          // term length + scope) but with the lowest score so real
          // matches outrank it — Enter only lands here when nothing
          // else hits.
          if (value === SEARCH_EVERYWHERE_VALUE) return 0.01;
          // Scope prefix (#/@/>): drop rows whose kind tag the scope
          // excludes, then match the stripped term against the
          // untagged text. Bare queries (scope null) match all kinds.
          const { scope, term } = parsePaletteQuery(search);
          const { kind, text } = splitPaletteValue(value);
          if (scope && !scopeAllowsKind(scope, kind)) return 0;
          if (!term) return 1;
          const v = text.toLowerCase();
          const q = term.toLowerCase();
          if (v.includes(q)) return 1;
          // Token-AND: every whitespace-separated term must be in the value.
          const tokens = q.split(/\s+/).filter(Boolean);
          return tokens.every((t) => v.includes(t)) ? 0.5 : 0;
        }}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Type to search — # matters · @ people · > actions"
        />

        <CommandList>
          <CommandEmpty>
            {data ? "No results." : "Loading…"}
          </CommandEmpty>

          {/* ── Contextual: pin/unpin current matter ─────────────────── */}
          {currentMatter && (
            <CommandGroup heading="On this matter">
              <CommandItem
                value={paletteValue(
                  "action",
                  `${currentMatter.isPinned ? "unpin" : "pin"} this matter ${currentMatter.name}`
                )}
                onSelect={toggleCurrentPin}
              >
                {currentMatter.isPinned ? <PinOff /> : <Pin />}
                <span>
                  {currentMatter.isPinned ? "Unpin" : "Pin"} this matter
                </span>
                <CommandShortcut>{currentMatter.name}</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}

          {/* ── Empty-query state: recents + pinned + suggestions ────── */}
          {!query && resolvedRecents.length > 0 && (
            <>
              <CommandGroup heading="Recent">
                {resolvedRecents.map(({ ref, item, nav }) => {
                  if (nav) {
                    const Icon = ICON_MAP[nav.icon] ?? Home;
                    return (
                      <CommandItem
                        key={`recent-${ref.kind}-${ref.id}`}
                        value={paletteValue(
                          "action",
                          `${nav.label} ${nav.keywords}`
                        )}
                        onSelect={() =>
                          go(nav.href, { kind: "nav", id: nav.id })
                        }
                      >
                        <Icon />
                        <span>{nav.label}</span>
                      </CommandItem>
                    );
                  }
                  if (!item) return null;
                  return (
                    <RecentItemRow
                      key={`recent-${item.kind}-${item.id}`}
                      item={item}
                      onGo={go}
                    />
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {!query && pinnedMatters.length > 0 && (
            <>
              <CommandGroup heading="Pinned matters">
                {pinnedMatters.map((m) => (
                  <MatterRow key={m.id} matter={m} onGo={go} />
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* ── Navigation (always searchable, hidden when not matching) */}
          <CommandGroup heading="Navigation">
            {NAV_ROWS.map((dest) => {
              const Icon = ICON_MAP[dest.icon] ?? Home;
              return (
                <CommandItem
                  key={dest.id}
                  value={paletteValue(
                    "action",
                    `${dest.label} ${dest.keywords}`
                  )}
                  onSelect={() =>
                    go(dest.href, { kind: "nav", id: dest.id })
                  }
                >
                  <Icon />
                  <span>{dest.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>

          {/* ── Create new (pure navigation; the target pages enforce
              their own permission gates — PaletteData carries no
              permission flags, see create-actions.ts) ─────────────── */}
          <CommandGroup heading="Create">
            {CREATE_ROWS.map((action) => {
              const Icon = ICON_MAP[action.icon] ?? Home;
              return (
                <CommandItem
                  key={action.id}
                  value={paletteValue(
                    "action",
                    `${action.label} ${action.keywords}`
                  )}
                  onSelect={() =>
                    go(action.href, { kind: "nav", id: action.id })
                  }
                >
                  <Icon />
                  <span>{action.label}</span>
                  <CommandShortcut>{action.href}</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>

          {/* ── All matters (cmdk filters to matches) ────────────────── */}
          {matters.length > 0 && (
            <CommandGroup heading="Matters">
              {matters.map((m) => (
                <MatterRow key={m.id} matter={m} onGo={go} />
              ))}
            </CommandGroup>
          )}

          {/* ── People ───────────────────────────────────────────────── */}
          {(contacts.length > 0 || users.length > 0) && (
            <CommandGroup heading="People">
              {users.map((u) => {
                if (u.kind !== "user") return null;
                return (
                  <CommandItem
                    key={`user-${u.id}`}
                    value={paletteValue(
                      "person",
                      `${u.name} ${u.jobTitle} ${u.initials} firm user`
                    )}
                    onSelect={() =>
                      go("/settings/team", { kind: "user", id: u.id })
                    }
                  >
                    <UserSquare />
                    <span>{u.name}</span>
                    <CommandShortcut>
                      {u.jobTitle} · {u.initials}
                    </CommandShortcut>
                  </CommandItem>
                );
              })}
              {contacts.map((c) => {
                if (c.kind !== "contact") return null;
                const typeLabel = CONTACT_TYPE_LABEL[c.contactType] ?? "Contact";
                return (
                  <CommandItem
                    key={`contact-${c.id}`}
                    value={paletteValue(
                      "person",
                      `${c.name} ${c.email ?? ""} ${c.organization ?? ""} ${c.contactType}`
                    )}
                    onSelect={() =>
                      go(`/contacts/${c.id}`, { kind: "contact", id: c.id })
                    }
                  >
                    <User />
                    <span>{c.name}</span>
                    <CommandShortcut>
                      {typeLabel}
                      {c.organization ? ` · ${c.organization}` : ""}
                    </CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {/* ── Leads ────────────────────────────────────────────────── */}
          {leads.length > 0 && (
            <CommandGroup heading="Leads">
              {leads.map((l) => {
                if (l.kind !== "lead") return null;
                return (
                  <CommandItem
                    key={`lead-${l.id}`}
                    value={paletteValue(
                      "lead",
                      `${l.name} ${l.email ?? ""} lead intake ${l.stage}`
                    )}
                    onSelect={() =>
                      go("/intake", { kind: "lead", id: l.id })
                    }
                  >
                    <Inbox />
                    <span>{l.name}</span>
                    <CommandShortcut>{l.stage}</CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {/* ── Search everywhere (footer row → /search?q=) ──────────
              Full-text content search across notes, email, documents,
              time narratives, etc. — the query-layer counterpart is
              globalSearch in src/lib/queries/search.ts. Renders only
              once the (prefix-stripped) term is long enough to be
              searchable; a #/@ scope narrows it via ?type=, and the
              row hides under > (actions have no full-text). */}
          {searchRowVisible && (
            <CommandGroup heading="Everywhere">
              <CommandItem
                value={SEARCH_EVERYWHERE_VALUE}
                onSelect={searchEverywhere}
              >
                <Search />
                <span>
                  Search everywhere for &ldquo;{parsed.term}&rdquo;
                </span>
                <CommandShortcut>
                  {searchType ? `${searchType}s · ` : ""}full-text
                </CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>

        {/* ── Footer: keyboard hints ────────────────────────────────── */}
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-2xs text-ink-4">
          <span>
            <Kbd>#</Kbd> matters <Kbd>@</Kbd> people <Kbd>&gt;</Kbd> actions
          </span>
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate <Kbd>↵</Kbd> select{" "}
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}

function MatterRow({
  matter,
  onGo,
}: {
  matter: PaletteMatter;
  onGo: (href: string, ref: RecentRef) => void;
}) {
  const value = paletteValue(
    "matter",
    `${matter.name} ${matter.caseNumber ?? ""} ${matter.clientName ?? ""} ${matter.area} ${matter.stage}`
  );
  return (
    <CommandItem
      value={value}
      onSelect={() =>
        onGo(`/matters/${matter.id}`, { kind: "matter", id: matter.id })
      }
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: matter.color }}
      />
      <span className="flex-1 truncate">{matter.name}</span>
      <CommandShortcut>
        {matter.caseNumber ? `${matter.caseNumber} · ` : ""}
        {matter.stage}
      </CommandShortcut>
    </CommandItem>
  );
}

function RecentItemRow({
  item,
  onGo,
}: {
  item: PaletteItem;
  onGo: (href: string, ref: RecentRef) => void;
}) {
  if (item.kind === "matter") return <MatterRow matter={item} onGo={onGo} />;
  if (item.kind === "contact") {
    return (
      <CommandItem
        value={paletteValue(
          "person",
          `${item.name} ${item.email ?? ""} ${item.organization ?? ""}`
        )}
        onSelect={() =>
          onGo(`/contacts/${item.id}`, { kind: "contact", id: item.id })
        }
      >
        <User />
        <span>{item.name}</span>
      </CommandItem>
    );
  }
  if (item.kind === "lead") {
    return (
      <CommandItem
        value={paletteValue("lead", `${item.name} lead ${item.stage}`)}
        onSelect={() => onGo("/intake", { kind: "lead", id: item.id })}
      >
        <Inbox />
        <span>{item.name}</span>
      </CommandItem>
    );
  }
  if (item.kind === "user") {
    return (
      <CommandItem
        value={paletteValue("person", `${item.name} ${item.jobTitle}`)}
        onSelect={() =>
          onGo("/settings/team", { kind: "user", id: item.id })
        }
      >
        <UserSquare />
        <span>{item.name}</span>
      </CommandItem>
    );
  }
  return null;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1 py-0.5 mx-0.5 rounded border border-line-2 bg-white font-mono text-2xs text-brand-700">
      {children}
    </kbd>
  );
}
