/**
 * Tab Placeholder
 *
 * Shared empty state for matter detail tabs that haven't been built
 * out yet. Mirrors SettingsPlaceholder so users see a consistent
 * "what's coming + what blocks it" treatment across the app.
 *
 * Pass `expectedItems` to list the planned features and `blockedBy`
 * when the tab depends on a not-yet-shipped phase. Without those it
 * falls back to a single-line "coming soon" card.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TabPlaceholder({
  title,
  description,
  expectedItems,
  blockedBy,
}: {
  title: string;
  description?: string;
  expectedItems?: string[];
  blockedBy?: string;
}) {
  // No expectedItems → keep the original compact card so callers that
  // only need a title don't suddenly get a wall of empty content.
  if (!expectedItems || expectedItems.length === 0) {
    return (
      <div className="p-5">
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-sm font-semibold text-ink mb-1">{title}</div>
            <div className="text-xs text-ink-3">
              {description ?? "This tab isn't built yet — coming soon."}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="max-w-2xl">
        <h2 className="text-lg font-display font-medium text-ink mb-1">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-ink-3 mb-5">{description}</p>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Coming as features land
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ul className="flex flex-col gap-1.5 text-xs text-ink-2 list-disc pl-4 mb-3">
              {expectedItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {blockedBy && (
              <div className="text-2xs text-ink-4 border-t border-line pt-3">
                Depends on: <span className="text-ink-3">{blockedBy}</span>
              </div>
            )}
            <div className="text-2xs text-ink-4 mt-3">
              See{" "}
              <code className="font-mono text-ink-3">docs/FEATURES.md</code>{" "}
              for the full roadmap.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
