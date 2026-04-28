/**
 * /settings/profile — current user's own profile.
 *
 * Editable: name, initials, phone, bar number, avatar URL.
 * Read-only sidebar: avatar, email, role, admin badge, firm,
 * member-since. Identity / governance fields stay read-only here —
 * email needs a re-verification flow (deferred), and role + admin
 * status flow through admin governance on /settings/team.
 *
 * Future bits that'll land here as their features go live:
 *   - Time zone, first day of the week, date/time format
 *   - Default calendar view
 *   - Notification preferences (when notifications land)
 *   - Connected accounts (Google, Microsoft) — when OAuth wires up
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileEditForm } from "@/components/settings/profile-edit-form";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { prisma } from "@/lib/prisma";

const formatDate = (d: Date | null): string => {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

export default async function ProfileSettingsPage() {
  const userId = await getCurrentUserId();
  // Pull every field directly — getCurrentUser is the lite version
  // for the sidebar; we want the full row for the edit form.
  const [user, firm] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        initials: true,
        jobTitle: true,
        phone: true,
        barNumber: true,
        avatarUrl: true,
        timeZone: true,
        defaultEventVisibility: true,
        isActive: true,
        createdAt: true,
        userRoles: {
          select: {
            role: { select: { id: true, name: true, isSystem: true } },
          },
        },
      },
    }),
    getCurrentFirm(),
  ]);
  // The middleware + getCurrentUserId guarantee a session, so a
  // missing row here would mean the row was deleted between the
  // session check and this query — treat as not-found.
  if (!user) notFound();

  return (
    <div className="grid grid-cols-[1fr_18rem] gap-6 max-w-5xl">
      <div>
        <div className="mb-4">
          <h1 className="text-base font-semibold text-ink">Profile</h1>
          <p className="text-xs text-ink-3 mt-1">
            Your personal info on this firm account. Changes flow to your
            sidebar avatar, party assignments, and time entries.
          </p>
        </div>

        <ProfileEditForm
          profile={{
            name: user.name,
            initials: user.initials,
            phone: user.phone,
            barNumber: user.barNumber,
            avatarUrl: user.avatarUrl,
            timeZone: user.timeZone,
            defaultEventVisibility: user.defaultEventVisibility,
          }}
        />

        <div className="mt-6 pt-4 border-t border-line text-2xs text-ink-4 leading-relaxed">
          <strong className="text-ink-3 font-medium">
            Want to change your password?
          </strong>{" "}
          Head to{" "}
          <Link
            href="/settings/security"
            className="text-brand-700 hover:underline"
          >
            Security
          </Link>{" "}
          (coming soon — for now, an admin can reset it on{" "}
          <Link
            href="/settings/team"
            className="text-brand-700 hover:underline"
          >
            Team
          </Link>
          ).
        </div>
      </div>

      {/* Right rail — read-only context. The values here are
          governance-controlled (admin via /settings/team) or identity
          (email + verified-at, eventually) so we surface them but
          don't let the user touch them. */}
      <aside className="flex flex-col gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span>Identity</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 shadow-[0_0_0_2px_var(--color-brand-100)]">
                {user.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt={user.name} />
                ) : null}
                <AvatarFallback className="text-sm font-semibold bg-[#efe3d9] text-ink-2">
                  {user.initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0">
                <div className="text-sm font-medium text-ink truncate">
                  {user.name}
                </div>
                <div className="text-2xs text-ink-4 truncate">{user.email}</div>
              </div>
            </div>

            <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-2xs pt-2 border-t border-line">
              <Row label="Job title" value={user.jobTitle} />
              <Row
                label="Status"
                value={user.isActive ? "Active" : "Deactivated"}
                accent={user.isActive ? undefined : "warn"}
              />
              <Row label="Member since" value={formatDate(user.createdAt)} />
            </dl>

            <div className="flex flex-col gap-1.5 pt-2 border-t border-line">
              <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
                Roles
              </div>
              <div className="flex flex-wrap gap-1">
                {user.userRoles.length === 0 ? (
                  <span className="text-2xs text-ink-4">—</span>
                ) : (
                  user.userRoles.map((ur) => (
                    <span
                      key={ur.role.id}
                      className={
                        "inline-flex items-center text-2xs font-medium px-1.5 py-0.5 rounded-full border " +
                        (ur.role.name === "Admin"
                          ? "bg-brand-soft text-brand-700 border-brand-200"
                          : "bg-paper-2 text-ink-3 border-line")
                      }
                    >
                      {ur.role.name}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 text-[10px] text-ink-4 px-2 py-1 rounded border border-line bg-paper-2 self-start">
              <Lock size={10} />
              Email + roles are managed by an admin on Team.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck
                size={14}
                className={
                  user.userRoles.some((ur) => ur.role.name === "Admin")
                    ? "text-brand-700"
                    : "text-ink-4"
                }
              />
              Firm
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium text-ink">
                {firm.shortName ?? firm.name}
              </div>
              {firm.shortName && (
                <div className="text-2xs text-ink-4">{firm.name}</div>
              )}
            </div>
            <Link
              href="/settings/firm"
              className="text-2xs text-brand-700 hover:underline mt-2 inline-block"
            >
              Open firm settings →
            </Link>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "brand" | "warn";
}) {
  const valueClass =
    accent === "brand"
      ? "text-brand-700 font-medium"
      : accent === "warn"
        ? "text-warn font-medium"
        : "text-ink";
  return (
    <>
      <dt className="text-ink-4">{label}</dt>
      <dd className={valueClass}>{value}</dd>
    </>
  );
}
