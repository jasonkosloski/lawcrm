/**
 * Activity-log icon names -> lucide icons.
 *
 * `ActivityLog.icon` is stored as a string (see `defaultIconFor()` in
 * `src/lib/activity-log.ts`, which owns the vocabulary). This is the
 * single name-to-component map for every surface that renders the feed
 * (dashboard "Recent activity", the audit page, the matter timeline).
 *
 * Client-safe (lucide icons only, no server imports). Unknown names
 * fall back via `activityIcon()`.
 */

import {
  Briefcase,
  Check,
  Circle,
  Clock,
  DollarSign,
  FileText,
  Gavel,
  Mail,
  Phone,
  ShieldCheck,
  StickyNote,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";

export const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  gavel: Gavel,
  mail: Mail,
  phone: Phone,
  video: Video,
  check: Check,
  zap: Zap,
  note: StickyNote,
  document: FileText,
  clock: Clock,
  dollar: DollarSign,
  briefcase: Briefcase,
  shield: ShieldCheck,
};

/** The icon for a stored icon name, or a plain circle when unknown. */
export function activityIcon(name: string | null | undefined): LucideIcon {
  return name && Object.hasOwn(ACTIVITY_ICONS, name) ? ACTIVITY_ICONS[name]! : Circle;
}
