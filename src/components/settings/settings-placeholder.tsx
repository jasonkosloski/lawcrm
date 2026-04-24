/**
 * Settings Placeholder
 *
 * Structured empty state for a settings section that isn't wired yet.
 * Each placeholder names the section and lists the expected contents so
 * future features know what they're plugging into.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsPlaceholder({
  title,
  description,
  expectedItems,
  blockedBy,
}: {
  title: string;
  description: string;
  expectedItems?: string[];
  blockedBy?: string;
}) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-display font-medium text-ink mb-1">{title}</h1>
      <p className="text-sm text-ink-3 mb-5">{description}</p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Coming as features land
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {expectedItems && expectedItems.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-xs text-ink-2 list-disc pl-4 mb-3">
              {expectedItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {blockedBy && (
            <div className="text-2xs text-ink-4 border-t border-line pt-3">
              Depends on: <span className="text-ink-3">{blockedBy}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
