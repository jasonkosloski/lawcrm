/**
 * /settings/profile — current user's own profile.
 *
 * Editable: name, initials, phone, bar number, avatar URL, time zone,
 * default event visibility. The header shows the fields the user can't
 * change here: email (it's their Google sign-in), job title and roles
 * (an admin sets those on /settings/team).
 */

import { notFound } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileEditForm } from "@/components/settings/profile-edit-form";
import { requireUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export default async function ProfileSettingsPage() {
  const userId = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      initials: true,
      jobTitle: true,
      phone: true,
      barNumber: true,
      avatarUrl: true,
      timeZone: true,
      defaultEventVisibility: true,
      userRoles: {
        select: { role: { select: { id: true, name: true } } },
      },
    },
  });
  // requireUser (above) guarantees a session, so a missing row means it
  // was deleted between the session check and this query.
  if (!user) notFound();

  return (
    <div className="max-w-2xl">
      <header className="flex items-center gap-4 mb-6">
        <Avatar className="h-12 w-12">
          {user.avatarUrl ? (
            <AvatarImage src={user.avatarUrl} alt="" />
          ) : null}
          <AvatarFallback className="text-sm font-semibold bg-[#efe3d9] text-ink-2">
            {user.initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-ink truncate">
            {user.name}
          </h1>
          <p className="text-xs text-ink-3 truncate">
            {[user.email, user.jobTitle].filter(Boolean).join(" · ")}
          </p>
          {user.userRoles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {user.userRoles.map((ur) => (
                <span
                  key={ur.role.id}
                  className={cn(
                    "inline-flex items-center text-2xs font-medium px-1.5 py-0.5 rounded-full border",
                    ur.role.name === "Admin"
                      ? "bg-brand-soft text-brand-700 border-brand-200"
                      : "bg-paper-2 text-ink-3 border-line"
                  )}
                >
                  {ur.role.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

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

      <p className="mt-6 text-2xs text-ink-4">
        Your email is your Google sign-in. An administrator manages job
        titles and roles on Team.
      </p>
    </div>
  );
}
