/**
 * Settings → Automations library (ADR-019): deadline rules, task
 * lists, and the automatic defaults that wire them to new matters.
 *
 * Every affordance is behind its own server-resolved flag (the
 * page passes them in); each action re-checks server-side.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { cn } from "@/lib/utils";
import { confirmAction, type ConfirmOptions } from "@/lib/feedback";
import {
  addAutoApply,
  deleteDeadlineRule,
  deleteTaskList,
  removeAutoApply,
  setDeadlineRuleActive,
  setTaskListActive,
} from "@/app/actions/automations";
import { automationInitialState, type AutomationFormState } from "@/lib/automation-form";
import type { AutoApplyRow, DeadlineRuleRow, TaskListRow } from "@/lib/queries/automations";
import { DeadlineRuleDialog } from "./deadline-rule-dialog";
import { TaskListDialog } from "./task-list-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type AutomationPermissions = {
  ruleCreate: boolean;
  ruleEdit: boolean;
  ruleDelete: boolean;
  listCreate: boolean;
  listEdit: boolean;
  listDelete: boolean;
  defaultsCreate: boolean;
  defaultsDelete: boolean;
};

export function AutomationsLibrary({
  rules,
  lists,
  defaults,
  practiceAreas,
  can,
}: {
  rules: DeadlineRuleRow[];
  lists: TaskListRow[];
  defaults: AutoApplyRow[];
  practiceAreas: { id: string; name: string }[];
  can: AutomationPermissions;
}) {
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: DeadlineRuleRow | null }>({
    open: false,
    rule: null,
  });
  const [listDialog, setListDialog] = useState<{ open: boolean; list: TaskListRow | null }>({
    open: false,
    list: null,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "That didn't work.");
    });

  // Deleting a rule/list cascades away every automatic default that
  // points at it — say so before the admin confirms.
  const defaultsNote = (kind: "rule" | "list", id: string) => {
    const n = defaults.filter((d) => d.targetKind === kind && d.targetId === id).length;
    return n === 0
      ? ""
      : ` This also removes ${n} automatic default${n === 1 ? "" : "s"} (new matters will stop getting it).`;
  };

  const confirmThen = async (
    opts: ConfirmOptions,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    if (await confirmAction(opts)) run(fn);
  };

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <div className="px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-xs text-warn">
          {error}
        </div>
      )}

      {/* ── Deadline rules ─────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <SectionHeader
          icon={CalendarClock}
          title="Deadline rules"
          hint="Reusable deadlines — “N days after/before” a date. Apply one from any matter's Deadlines tab."
          action={
            can.ruleCreate && (
              <Button
                size="xs"
                type="button"
                onClick={() => setRuleDialog({ open: true, rule: null })}
              >
                <Plus size={13} /> New rule
              </Button>
            )
          }
        />
        {rules.length === 0 ? (
          <Empty
            title="No deadline rules yet"
            text="Create one for each recurring deadline — notice periods, filing windows, pretrial dates."
          />
        ) : (
          <Rows>
            {rules.map((r) => (
              <Row
                key={r.id}
                inactive={!r.isActive}
                title={r.title}
                badge={r.kind === "critical" ? "Critical" : null}
                sub={[r.summary, r.sourceRef].filter(Boolean).join(" · ")}
                menu={
                  <RowMenu
                    label={r.title}
                    disabled={pending}
                    onEdit={can.ruleEdit ? () => setRuleDialog({ open: true, rule: r }) : undefined}
                    archived={!r.isActive}
                    onToggleArchive={
                      can.ruleEdit
                        ? () => run(() => setDeadlineRuleActive(r.id, !r.isActive))
                        : undefined
                    }
                    onDelete={
                      can.ruleDelete
                        ? () =>
                            void confirmThen(
                              {
                                title: `Delete the rule "${r.title}"?`,
                                description: `Deadlines it already created stay on their matters.${defaultsNote("rule", r.id)}`,
                                confirmLabel: "Delete rule",
                                destructive: true,
                              },
                              () => deleteDeadlineRule(r.id),
                            )
                        : undefined
                    }
                  />
                }
              />
            ))}
          </Rows>
        )}
      </section>

      {/* ── Task lists ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <SectionHeader
          icon={ListChecks}
          title="Task lists"
          hint="Reusable checklists. Apply one from any matter's Tasks tab."
          action={
            can.listCreate && (
              <Button
                size="xs"
                type="button"
                onClick={() => setListDialog({ open: true, list: null })}
              >
                <Plus size={13} /> New task list
              </Button>
            )
          }
        />
        {lists.length === 0 ? (
          <Empty
            title="No task lists yet"
            text="Create checklists for intake, case opening, discovery, closing — whatever repeats."
          />
        ) : (
          <Rows>
            {lists.map((l) => (
              <Row
                key={l.id}
                inactive={!l.isActive}
                title={l.name}
                badge={`${l.items.length} task${l.items.length === 1 ? "" : "s"}`}
                sub={l.items.map((i) => i.title).join(" · ")}
                menu={
                  <RowMenu
                    label={l.name}
                    disabled={pending}
                    onEdit={can.listEdit ? () => setListDialog({ open: true, list: l }) : undefined}
                    archived={!l.isActive}
                    onToggleArchive={
                      can.listEdit
                        ? () => run(() => setTaskListActive(l.id, !l.isActive))
                        : undefined
                    }
                    onDelete={
                      can.listDelete
                        ? () =>
                            void confirmThen(
                              {
                                title: `Delete the task list "${l.name}"?`,
                                description: `Tasks it already created stay on their matters.${defaultsNote("list", l.id)}`,
                                confirmLabel: "Delete task list",
                                destructive: true,
                              },
                              () => deleteTaskList(l.id),
                            )
                        : undefined
                    }
                  />
                }
              />
            ))}
          </Rows>
        )}
      </section>

      {/* ── Automatic defaults ─────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <SectionHeader
          icon={Zap}
          title="Apply automatically to new matters"
          hint="Runs when a matter is created from the New-matter form or by converting a lead. Rules that can't be dated yet (e.g. no incident date) become a “Set date” task instead."
        />
        {can.defaultsCreate && (
          <AddDefaultForm
            rules={rules.filter((r) => r.isActive)}
            lists={lists.filter((l) => l.isActive)}
            practiceAreas={practiceAreas}
          />
        )}
        {defaults.length === 0 ? (
          <Empty
            title="Nothing applies automatically yet"
            text="Add a rule or task list above to have new matters start with it."
          />
        ) : (
          <Rows>
            {defaults.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2">
                {d.targetKind === "rule" ? (
                  <CalendarClock size={14} className="text-ink-4" />
                ) : (
                  <ListChecks size={14} className="text-ink-4" />
                )}
                <div className="flex-1 min-w-0 text-xs text-ink">
                  <span className="font-medium">{d.targetName}</span>
                  {!d.targetActive && (
                    <span className="ml-1.5 text-2xs text-warn">(archived — skipped)</span>
                  )}
                  <span className="text-ink-4"> → new matters in </span>
                  <span className="font-medium">{d.practiceAreaName ?? "every practice area"}</span>
                </div>
                {can.defaultsDelete && (
                  <button
                    type="button"
                    aria-label={`Stop applying ${d.targetName}`}
                    disabled={pending}
                    onClick={() => run(() => removeAutoApply(d.id))}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </Rows>
        )}
      </section>

      <DeadlineRuleDialog
        open={ruleDialog.open}
        onOpenChange={(open) => setRuleDialog((s) => ({ ...s, open }))}
        rule={ruleDialog.rule}
        allRules={rules}
      />
      <TaskListDialog
        open={listDialog.open}
        onOpenChange={(open) => setListDialog((s) => ({ ...s, open }))}
        list={listDialog.list}
      />
    </div>
  );
}

function AddDefaultForm({
  rules,
  lists,
  practiceAreas,
}: {
  rules: DeadlineRuleRow[];
  lists: TaskListRow[];
  practiceAreas: { id: string; name: string }[];
}) {
  // Inline form stays mounted; `true` = never reset the masking.
  const [state, formAction, isPending] = useDialogActionState<AutomationFormState, FormData>(
    addAutoApply,
    automationInitialState,
    true,
  );
  // Dispatch manually instead of <form action>: React 19 resets the
  // form after the action settles even on a validation error, which
  // would snap both selects back. Reset by hand only on success.
  const formRef = useRef<HTMLFormElement>(null);
  const [, startSubmit] = useTransition();
  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);
  const err = state.errors?.target?.[0] ?? state.errors?.practiceAreaId?.[0];
  if (rules.length === 0 && lists.length === 0) return null;
  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startSubmit(() => formAction(data));
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="trigger" value="matter_created" />
      <NativeSelect name="target" required defaultValue="" aria-label="Rule or task list">
        <NativeSelectOption value="" disabled>
          Choose a rule or task list…
        </NativeSelectOption>
        {rules.length > 0 && (
          <NativeSelectOptGroup label="Deadline rules">
            {rules.map((r) => (
              <NativeSelectOption key={r.id} value={`rule:${r.id}`}>
                {r.title}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        )}
        {lists.length > 0 && (
          <NativeSelectOptGroup label="Task lists">
            {lists.map((l) => (
              <NativeSelectOption key={l.id} value={`list:${l.id}`}>
                {l.name}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        )}
      </NativeSelect>
      <span className="text-xs text-ink-4">for new matters in</span>
      <NativeSelect name="practiceAreaId" defaultValue="" aria-label="Practice area">
        <NativeSelectOption value="">Every practice area</NativeSelectOption>
        {practiceAreas.map((a) => (
          <NativeSelectOption key={a.id} value={a.id}>
            {a.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button size="xs" type="submit" disabled={isPending}>
        <Plus size={13} /> Add
      </Button>
      {err && <span className="text-2xs text-warn w-full">{err}</span>}
    </form>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Icon size={14} className="text-ink-4" /> {title}
        </h2>
        <p className="text-2xs text-ink-4 mt-0.5 max-w-xl leading-relaxed">{hint}</p>
      </div>
      {action}
    </div>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="divide-y divide-line">{children}</div>
    </Card>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardContent className="p-0">
        <EmptyState title={title} description={text} className="py-6" />
      </CardContent>
    </Card>
  );
}

function Row({
  title,
  sub,
  badge,
  inactive,
  menu,
}: {
  title: string;
  sub: string;
  badge: string | null;
  inactive: boolean;
  menu: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-3 py-2", inactive && "opacity-60")}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink truncate">{title}</span>
          {badge && <Badge variant="neutral">{badge}</Badge>}
          {inactive && <span className="text-2xs text-ink-4 shrink-0">Archived</span>}
        </div>
        {sub && <div className="text-2xs text-ink-4 truncate">{sub}</div>}
      </div>
      {menu}
    </div>
  );
}

function RowMenu({
  label,
  disabled,
  onEdit,
  archived,
  onToggleArchive,
  onDelete,
}: {
  label: string;
  disabled: boolean;
  onEdit?: () => void;
  archived: boolean;
  onToggleArchive?: () => void;
  onDelete?: () => void;
}) {
  if (!onEdit && !onToggleArchive && !onDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Actions for ${label}`}
            disabled={disabled}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
          >
            <MoreHorizontal size={14} />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-40">
        {onEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil /> Edit
          </DropdownMenuItem>
        )}
        {onToggleArchive && (
          <DropdownMenuItem onClick={onToggleArchive}>
            {archived ? <ArchiveRestore /> : <Archive />}
            {archived ? "Restore" : "Archive"}
          </DropdownMenuItem>
        )}
        {onDelete && (
          <>
            {(onEdit || onToggleArchive) && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 /> Delete permanently
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
