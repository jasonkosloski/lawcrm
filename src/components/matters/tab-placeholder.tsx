/**
 * Tab Placeholder
 *
 * Shared empty state for matter detail tabs that haven't been built out
 * yet. The `title` names the tab so each route still feels distinct
 * when the user clicks through.
 */

import { Card, CardContent } from "@/components/ui/card";

export function TabPlaceholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
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
