/**
 * "No one has a bar number yet" notice with the two Settings spots
 * linked. Wording matches NO_ATTORNEYS in attorney-messages.ts.
 */

"use client";

import Link from "next/link";

export function NoAttorneysNotice() {
  return (
    <div className="text-xs text-warn">
      No one has a bar number yet — add yours in{" "}
      <Link href="/settings/profile" className="underline">
        Settings → Profile
      </Link>
      , or a teammate&apos;s in{" "}
      <Link href="/settings/team" className="underline">
        Settings → Team
      </Link>
      .
    </div>
  );
}
