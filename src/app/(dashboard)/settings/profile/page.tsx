/**
 * Profile Settings
 *
 * Shows the current user's profile info. Read-only for now —
 * edit form + server action will follow in Phase 9 Auth when we can
 * safely validate changes against a real session.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getCurrentUser } from "@/lib/current-user";

const formatValue = (v: string | null | undefined): string => v || "—";

export default async function ProfileSettingsPage() {
  const user = await getCurrentUser();

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-display font-medium text-ink mb-1">Profile</h1>
      <p className="text-sm text-ink-3 mb-5">
        Your personal info on this firm account.
      </p>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 shadow-[0_0_0_2px_var(--color-brand-100)]">
              <AvatarFallback className="text-sm font-semibold bg-[#efe3d9] text-ink-2">
                {user?.initials ?? "??"}
              </AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-base font-medium">
                {formatValue(user?.name)}
              </CardTitle>
              <div className="text-xs text-ink-3">
                {formatValue(user?.role)}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-xs border-t border-line pt-4">
            <Field label="Display name" value={user?.name} />
            <Field label="Role" value={user?.role} />
            <Field label="Initials" value={user?.initials} mono />
          </dl>

          <div className="mt-5 pt-4 border-t border-line text-2xs text-ink-4">
            Editing is disabled until Phase 9 auth lands. Profile updates
            need a real session to attribute the change to the right user.
            Future per-user preferences that will live on this page:
            first day of the week (Sun / Mon), time zone, date + time
            format, default calendar view.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-ink-4 mb-0.5">{label}</dt>
      <dd className={mono ? "font-mono text-ink" : "text-ink"}>
        {formatValue(value)}
      </dd>
    </div>
  );
}
