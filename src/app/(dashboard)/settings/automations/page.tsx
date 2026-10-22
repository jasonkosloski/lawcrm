/**
 * Settings → Automations (ADR-019).
 *
 * The firm's deadline rules and task lists, plus which ones apply
 * automatically when a matter is created. Viewing is gated on
 * `automations.view`; every manage affordance on its own key, and
 * each action re-checks server-side.
 */

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permission-check";
import { listAutoApplies, listDeadlineRules, listTaskLists } from "@/lib/queries/automations";
import { AutomationsLibrary } from "@/components/automations/automations-library";
import { requireUser } from "@/lib/current-user";

export default async function AutomationsSettingsPage() {
  await requireUser();
  const { isAdmin, granted } = await getCurrentUserPermissions();
  const can = (key: string) => isAdmin || granted.has(key);
  if (!can("automations.view")) redirect("/");

  const [rules, lists, defaults, practiceAreas] = await Promise.all([
    listDeadlineRules(),
    listTaskLists(),
    listAutoApplies(),
    prisma.practiceArea.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Automations</h1>
        <p className="text-xs text-ink-4 mt-1 leading-relaxed max-w-2xl">
          Deadline rules and task lists the firm reuses across matters. Apply them by hand from any
          matter, or have them added automatically when a new matter is created. Changes here only
          affect future applications — nothing already on a matter moves.
        </p>
      </div>

      <AutomationsLibrary
        rules={rules}
        lists={lists}
        defaults={defaults}
        practiceAreas={practiceAreas}
        can={{
          ruleCreate: can("automations.deadline_rule.create"),
          ruleEdit: can("automations.deadline_rule.edit"),
          ruleDelete: can("automations.deadline_rule.delete"),
          listCreate: can("automations.task_list.create"),
          listEdit: can("automations.task_list.edit"),
          listDelete: can("automations.task_list.delete"),
          defaultsCreate: can("automations.defaults.create"),
          defaultsDelete: can("automations.defaults.delete"),
        }}
      />
    </div>
  );
}
