/**
 * Messenger Thread Reader
 *
 * Right pane: header (contact + matter context) + chat-bubble body
 * (mixed SMS / call / voicemail items). Outbound on the right,
 * inbound on the left, calls and voicemails as centered system
 * cards. Composer footer is a v1 add — for now it shows a "compose
 * coming with provider integration" hint.
 *
 * Server component for read; the eventual composer + per-item
 * file-to-matter picker will mount as client islands inside.
 */

import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  MessageSquare,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Voicemail,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BackToListButton } from "./back-to-list-button";
import type {
  MessengerItemRow,
  MessengerThreadDetail,
} from "@/lib/queries/messenger";
import { InboxActionButtons } from "./inbox-action-buttons";
import { FollowUpButton } from "./follow-up-button";
import { setMessengerThreadFollowUp } from "@/app/actions/follow-ups";
import { LogTimeOnCommButton } from "./log-time-on-comm-button";
import { CommTimeLoggedIndicator } from "./comm-time-logged-indicator";

function prettyPhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return p;
}

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export function MessengerThreadReader({
  thread,
}: {
  thread: MessengerThreadDetail | null;
}) {
  if (!thread) {
    // Empty-state — only useful at lg+ where the list is visible
    // alongside. On mobile the list IS the home view; the
    // placeholder would just take screen space, so hide it.
    return (
      <div className="hidden lg:flex flex-1 items-center justify-center bg-paper-2/30">
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-500 flex items-center justify-center mx-auto mb-3">
            <MessageSquare size={20} />
          </div>
          <div className="text-sm font-semibold text-ink mb-1">
            Select a conversation
          </div>
          <div className="text-2xs text-ink-3 leading-relaxed">
            Pick a thread from the left to read its messages, calls, and
            voicemails. Threads land here automatically when texts and
            calls arrive on the firm Quo line.
          </div>
        </div>
      </div>
    );
  }

  const headline =
    thread.contact?.name ?? prettyPhone(thread.contactPhone);
  const subhead = thread.contact
    ? prettyPhone(thread.contactPhone)
    : "Unknown number";

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* Header — identity row always at the top, action row floats
          right on sm+ and wraps below on `<sm` so the matter pill +
          follow-up button get full tap targets without squeezing
          the contact name. */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 px-3 sm:px-5 py-3 border-b border-line shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <BackToListButton />
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center text-2xs font-mono font-medium shrink-0">
            {(thread.contact?.name ?? "?")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase() ?? "")
              .join("") || "?"}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-ink truncate">
              {headline}
            </span>
            <span className="text-2xs font-mono text-ink-4 truncate">
              {subhead}
              {thread.contact?.organization
                ? ` · ${thread.contact.organization}`
                : ""}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <FollowUpButton
            threadId={thread.id}
            followUpAt={thread.followUpAt}
            action={setMessengerThreadFollowUp}
          />
          {thread.defaultMatter ? (
            <Link
              href={`/matters/${thread.defaultMatter.id}`}
              className="inline-flex items-center gap-1.5 text-2xs px-2 py-1 rounded-full border border-line hover:border-brand-300 hover:text-brand-700 transition-colors min-w-0"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: thread.defaultMatter.color }}
              />
              <Briefcase size={11} className="text-ink-3 shrink-0" />
              <span className="text-ink-2 truncate max-w-[10rem] sm:max-w-[14rem]">
                {thread.defaultMatter.name}
              </span>
            </Link>
          ) : (
            <span className="text-2xs text-ink-4 italic">Unfiled</span>
          )}
        </div>
      </header>

      {/* Body — tighter horizontal padding on phones to maximize
          bubble width. */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 flex flex-col gap-2.5">
        {thread.items.length === 0 ? (
          <div className="m-auto text-2xs text-ink-4">
            No messages in this thread yet.
          </div>
        ) : (
          thread.items.map((it) => (
            <Item
              key={it.id}
              item={it}
              contactLabel={headline}
              isFiled={
                // An item is actionable if it has its own matterId or
                // the thread defaults to one — matches the same logic
                // resolveMessengerMatter uses on the server.
                it.matterId !== null || thread.defaultMatter !== null
              }
            />
          ))
        )}
      </div>

      {/* Composer placeholder */}
      <footer className="border-t border-line px-5 py-3 shrink-0 bg-paper-2/30">
        <div className="text-2xs text-ink-4 italic">
          Composer ships with the Quo integration. Inbound messages flow in
          via webhook; outbound send + file-to-matter picker land in v1.
        </div>
      </footer>
    </div>
  );
}

function Item({
  item,
  contactLabel,
  isFiled,
}: {
  item: MessengerItemRow;
  contactLabel: string;
  isFiled: boolean;
}) {
  if (item.kind === "call")
    return (
      <CallEvent item={item} contactLabel={contactLabel} isFiled={isFiled} />
    );
  if (item.kind === "voicemail")
    return (
      <VoicemailCard
        item={item}
        contactLabel={contactLabel}
        isFiled={isFiled}
      />
    );
  return (
    <SmsBubble item={item} contactLabel={contactLabel} isFiled={isFiled} />
  );
}

/** Build the source label passed into the LogTimeOnCommButton dialog
 *  for SMS / call / voicemail items. Includes contact name + a short
 *  preview so the dialog title makes sense at a glance. */
function commLabel(
  contactLabel: string,
  item: MessengerItemRow
): string {
  if (item.kind === "voicemail")
    return `Voicemail from ${contactLabel}`;
  if (item.kind === "call") {
    const dir = item.direction === "inbound" ? "Inbound" : "Outbound";
    const missed =
      item.callStatus === "missed" || item.callStatus === "no_answer";
    return `${missed ? "Missed call" : `${dir} call`} · ${contactLabel}`;
  }
  // SMS — quote the body if present so context stands.
  const preview = item.body
    ? item.body.length > 40
      ? item.body.slice(0, 37) + "…"
      : item.body
    : "(media)";
  return `${contactLabel}: "${preview}"`;
}

function SmsBubble({
  item,
  contactLabel,
  isFiled,
}: {
  item: MessengerItemRow;
  contactLabel: string;
  isFiled: boolean;
}) {
  const outbound = item.direction === "outbound";
  return (
    <div
      className={cn(
        "group/msg flex items-end gap-2 max-w-[80%]",
        outbound ? "self-end flex-row-reverse" : "self-start"
      )}
    >
      <div
        className={cn(
          "rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-sm",
          outbound
            ? "bg-brand-500 text-white rounded-br-sm"
            : "bg-paper-2 text-ink rounded-bl-sm"
        )}
      >
        {item.body && (
          <div className="whitespace-pre-wrap break-words">{item.body}</div>
        )}
        {item.mediaUrls.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {item.mediaUrls.map((m, i) => (
              <a
                key={i}
                href={m.url}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  "text-2xs underline",
                  outbound ? "text-white/80" : "text-brand-700"
                )}
              >
                Attachment {i + 1}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 pb-1">
        <span className="text-3xs font-mono text-ink-4">
          {format(item.occurredAt, "h:mm a")}
        </span>
        {/* Time-logged indicator — always visible when there's time,
            so the bubble shows a hint of "0.4h logged" without hover. */}
        {item.timeEntries.length > 0 && (
          <CommTimeLoggedIndicator
            entries={item.timeEntries}
            compact
            align={outbound ? "right" : "left"}
          />
        )}
      </div>
      {/* Hover-reveal log-time icon — keeps SMS bubbles uncluttered
          at rest. The hide-at-rest rule is gated to hover-capable
          devices (hover:hover); touch has no hover to reveal it, so
          there the button stays visible. */}
      <div className="[@media(hover:hover)]:opacity-0 group-hover/msg:opacity-100 transition-opacity pb-1">
        <LogTimeOnCommButton
          isFiled={isFiled}
          variant="compact"
          source={{
            kind: "messenger",
            itemId: item.id,
            label: commLabel(contactLabel, item),
          }}
        />
      </div>
    </div>
  );
}

function CallEvent({
  item,
  contactLabel,
  isFiled,
}: {
  item: MessengerItemRow;
  contactLabel: string;
  isFiled: boolean;
}) {
  const missed = item.callStatus === "missed" || item.callStatus === "no_answer";
  const Icon = missed
    ? PhoneMissed
    : item.direction === "inbound"
      ? PhoneIncoming
      : PhoneOutgoing;
  const label = missed
    ? `Missed call · ${formatDistanceToNowStrict(item.occurredAt, { addSuffix: true })}`
    : `${item.direction === "inbound" ? "Inbound" : "Outbound"} call · ${formatDuration(item.callDurationSec)}`;
  return (
    <div className="self-center flex flex-col items-center gap-1 max-w-[26rem]">
      <div className="group/call flex items-center gap-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-line bg-paper-2/50 text-2xs text-ink-3">
          <Icon size={11} className={missed ? "text-warn" : "text-ink-3"} />
          <span className={missed ? "text-warn font-medium" : "text-ink-3"}>
            {label}
          </span>
          <span className="font-mono text-ink-4">
            {format(item.occurredAt, "h:mm a")}
          </span>
        </div>
        {/* Time-logged indicator stays visible (without hover) once
            time exists — matches voicemail / SMS behavior. */}
        {item.timeEntries.length > 0 && (
          <CommTimeLoggedIndicator entries={item.timeEntries} compact />
        )}
        {/* Same hover-reveal treatment as SMS bubbles — hidden at
            rest only where hover exists; always visible on touch. */}
        <div className="[@media(hover:hover)]:opacity-0 group-hover/call:opacity-100 transition-opacity">
          <LogTimeOnCommButton
            isFiled={isFiled}
            variant="compact"
            source={{
              kind: "messenger",
              itemId: item.id,
              label: commLabel(contactLabel, item),
            }}
          />
        </div>
      </div>
      {/* Call summary — schema stores it in `body` (manual call
          logging writes it; provider call summaries land here too). */}
      {item.body && (
        <div className="text-2xs text-ink-3 bg-paper-2/50 border border-line rounded-md px-3 py-1.5 whitespace-pre-wrap text-left">
          {item.body}
        </div>
      )}
    </div>
  );
}

function VoicemailCard({
  item,
  contactLabel,
  isFiled,
}: {
  item: MessengerItemRow;
  contactLabel: string;
  isFiled: boolean;
}) {
  // Voicemails are the highest-leverage source for inbox actions —
  // the transcript usually contains an explicit ask ("call me back
  // about X by Y"). Surface task / deadline / note buttons inline so
  // the user doesn't have to leave the conversation to act on it.
  return (
    <div className="self-start max-w-[80%] rounded-lg border border-line bg-paper-2/40 px-3 py-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Voicemail size={12} className="text-brand-500" />
        <span className="text-2xs font-mono uppercase tracking-wider text-ink-3">
          Voicemail
        </span>
        {/* Explicit > 0 guard — a bare `&&` on a 0-second voicemail
            (provider edge case) renders a literal "0" text node. */}
        {item.callDurationSec != null && item.callDurationSec > 0 && (
          <span className="text-3xs font-mono text-ink-4">
            {formatDuration(item.callDurationSec)}
          </span>
        )}
        <span className="ml-auto text-3xs font-mono text-ink-4">
          {format(item.occurredAt, "h:mm a")}
        </span>
      </div>
      {item.transcript && (
        <p className="text-xs text-ink leading-relaxed whitespace-pre-wrap">
          {item.transcript}
        </p>
      )}
      {item.recordingUrl && (
        <audio
          controls
          src={item.recordingUrl}
          className="w-full h-8"
          preload="none"
        />
      )}
      <div className="pt-1.5 border-t border-line/60 flex items-center gap-1.5 flex-wrap">
        <InboxActionButtons
          isFiled={isFiled}
          source={{
            kind: "messenger",
            id: item.id,
            contactLabel,
            preview: item.transcript ?? "Voicemail (no transcript)",
          }}
        />
        <LogTimeOnCommButton
          isFiled={isFiled}
          source={{
            kind: "messenger",
            itemId: item.id,
            label: commLabel(contactLabel, item),
          }}
        />
        {item.timeEntries.length > 0 && (
          <CommTimeLoggedIndicator entries={item.timeEntries} />
        )}
      </div>
    </div>
  );
}
