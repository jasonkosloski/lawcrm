/** Centered sign-in panel shared by /login and /auth/verify. */

import { Card } from "@/components/ui/card";

export function AuthPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md sm:pt-4">
      <Card className="gap-6 px-6 py-7 shadow-sm ring-line sm:px-8 sm:py-8">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-medium tracking-tight text-brand-900">
            {title}
          </h1>
          {description ? (
            <p className="text-sm leading-relaxed text-ink-3">{description}</p>
          ) : null}
        </div>
        {children}
      </Card>
    </div>
  );
}
