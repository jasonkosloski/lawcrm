/**
 * automations actions — real DB; auth + TZ mocked.
 */


import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({ getCurrentUserTimeZone: vi.fn(async () => "UTC") }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import {
  addAutoApply,
  applyDeadlineRuleToMatter,
  applyTaskListToMatter,
  createDeadlineRule,
  createTaskList,
  deleteDeadlineRule,
  deleteTaskList,
  removeAutoApply,
  setDeadlineRuleActive,
  setTaskListActive,
  updateDeadlineRule,
  updateTaskList,
} from "@/app/actions/automations";
import { automationInitialState } from "@/lib/automation-form";
import { dateOnlyKey } from "@/lib/format-date";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;
let areaId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(requirePermission).mockResolvedValue(userId);
  const pa = await seedPracticeArea();
  areaId = pa.areaId;
  ({ matterId } = await seedMatter({ practiceAreaId: pa.areaId, stageId: pa.stageId, leadUserId: userId }));
  await prisma.matter.update({
    where: { id: matterId },
    data: { incidentDate: new Date("2026-03-10T00:00:00Z") },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const ruleForm = (over: Record<string, string> = {}) =>
  fd({
    title: "CGIA notice",
    kind: "critical",
    anchor: "incident_date",
    amount: "182",
    unit: "days",
    direction: "after",
    sourceRef: "C.R.S. § 24-10-109",
    ...over,
  });

const gate = () => vi.mocked(requirePermission).mock.calls.map((c) => c[0]);

describe("deadline rules", () => {
  test("create packs the offset, keeps the entered unit, logs firm-wide", async () => {
    const res = await createDeadlineRule(automationInitialState, ruleForm({ amount: "2", unit: "years" }));
    expect(res.status).toBe("ok");
    expect(gate()).toEqual(["automations.deadline_rule.create"]);
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    expect(rule).toMatchObject({ offsetDays: 730, offsetUnit: "years", anchorRuleId: null, anchorLabel: null });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { type: "automation" } });
    expect(log).toMatchObject({ matterId: null, title: "Created deadline rule: CGIA notice" });
  });

  test("'before' is stored as a negative offset", async () => {
    await createDeadlineRule(automationInitialState, ruleForm({ amount: "30", direction: "before" }));
    expect((await prisma.deadlineRule.findFirstOrThrow()).offsetDays).toBe(-30);
  });

  test("validation: rule anchors need a rule; bad numbers are refused", async () => {
    const noAnchor = await createDeadlineRule(automationInitialState, ruleForm({ anchor: "rule" }));
    expect(noAnchor.errors?.anchorRuleId).toBeTruthy();
    const neg = await createDeadlineRule(automationInitialState, ruleForm({ amount: "-5" }));
    expect(neg.errors?.amount).toBeTruthy();
    expect(await prisma.deadlineRule.count()).toBe(0);
  });

  test("a huge amount-times-unit is refused (it would overflow the calendar and block matter creation)", async () => {
    // Each field is within its own cap, but 36,500 years is ~13M days.
    const years = await createDeadlineRule(automationInitialState, ruleForm({ amount: "36500", unit: "years" }));
    expect(years.errors?.amount?.[0]).toMatch(/over 100 years/);
    const months = await createDeadlineRule(automationInitialState, ruleForm({ amount: "9999", unit: "months", direction: "before" }));
    expect(months.errors?.amount?.[0]).toMatch(/over 100 years/);
    expect(await prisma.deadlineRule.count()).toBe(0);
    // 100 years of days is the edge that still saves.
    expect((await createDeadlineRule(automationInitialState, ruleForm({ amount: "36500", unit: "days" }))).status).toBe("ok");
  });

  test("archive / restore: gated on edit, audited, a missing id is an error result not a throw", async () => {
    await createDeadlineRule(automationInitialState, ruleForm());
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    vi.mocked(requirePermission).mockClear();
    expect(await setDeadlineRuleActive(rule.id, false)).toEqual({ ok: true });
    expect(gate()).toEqual(["automations.deadline_rule.edit"]);
    expect((await prisma.deadlineRule.findUniqueOrThrow({ where: { id: rule.id } })).isActive).toBe(false);
    expect(await setDeadlineRuleActive(rule.id, true)).toEqual({ ok: true });
    const titles = (await prisma.activityLog.findMany({ where: { type: "automation" } })).map((l) => l.title);
    expect(titles).toContain("Archived deadline rule: CGIA notice");
    expect(titles).toContain("Restored deadline rule: CGIA notice");

    const missing = await setDeadlineRuleActive("does-not-exist", false);
    expect(missing).toEqual({ ok: false, error: "Rule not found." });
  });

  test("a denied user changes nothing", async () => {
    await createDeadlineRule(automationInitialState, ruleForm());
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    vi.mocked(requirePermission).mockRejectedValue(new Error("Forbidden"));
    await expect(setDeadlineRuleActive(rule.id, false)).rejects.toThrow("Forbidden");
    await expect(deleteDeadlineRule(rule.id)).rejects.toThrow("Forbidden");
    await expect(createDeadlineRule(automationInitialState, ruleForm({ title: "Nope" }))).rejects.toThrow("Forbidden");
    expect(await prisma.deadlineRule.count()).toBe(1);
    expect((await prisma.deadlineRule.findUniqueOrThrow({ where: { id: rule.id } })).isActive).toBe(true);
  });

  test("update refuses a loop between rules", async () => {
    await createDeadlineRule(automationInitialState, ruleForm({ title: "A" }));
    const a = await prisma.deadlineRule.findFirstOrThrow({ where: { title: "A" } });
    await createDeadlineRule(automationInitialState, ruleForm({ title: "B", anchor: "rule", anchorRuleId: a.id }));
    const b = await prisma.deadlineRule.findFirstOrThrow({ where: { title: "B" } });
    const res = await updateDeadlineRule(a.id, automationInitialState, ruleForm({ title: "A", anchor: "rule", anchorRuleId: b.id }));
    expect(res.errors?.anchorRuleId?.[0]).toMatch(/loop/);
    expect((await prisma.deadlineRule.findUniqueOrThrow({ where: { id: a.id } })).anchorRuleId).toBeNull();
  });

  test("delete is refused while other rules count from it; generated deadlines survive", async () => {
    await createDeadlineRule(automationInitialState, ruleForm({ title: "Trial", anchor: "prompt", amount: "0" }));
    const trial = await prisma.deadlineRule.findFirstOrThrow();
    await createDeadlineRule(automationInitialState, ruleForm({ title: "Motions", anchor: "rule", anchorRuleId: trial.id, amount: "30", direction: "before" }));
    const blocked = await deleteDeadlineRule(trial.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/Motions/);

    const motions = await prisma.deadlineRule.findFirstOrThrow({ where: { title: "Motions" } });
    await applyDeadlineRuleToMatter(matterId, trial.id, { anchorDate: "2027-04-15" });
    expect((await deleteDeadlineRule(motions.id)).ok).toBe(true);
    expect((await deleteDeadlineRule(trial.id)).ok).toBe(true);
    const kept = await prisma.deadline.findFirstOrThrow({ where: { matterId } });
    expect(kept.deadlineRuleId).toBeNull();
  });
});

describe("task lists", () => {
  const items = JSON.stringify([
    { title: "Send engagement letter", assignTo: "lead", dueOffsetDays: 3, priority: "high" },
    { title: "Request records" },
  ]);

  test("create stores ordered items with defaults", async () => {
    const res = await createTaskList(automationInitialState, fd({ name: "Intake", items }));
    expect(res.status).toBe("ok");
    const list = await prisma.taskList.findFirstOrThrow({ include: { items: { orderBy: { sortOrder: "asc" } } } });
    expect(list.items.map((i) => [i.title, i.assignTo, i.priority, i.dueOffsetDays])).toEqual([
      ["Send engagement letter", "lead", "high", 3],
      ["Request records", "unassigned", "normal", null],
    ]);
  });

  test("validation: needs items, readable JSON, titled items", async () => {
    expect((await createTaskList(automationInitialState, fd({ name: "X", items: "[]" }))).status).toBe("error");
    expect((await createTaskList(automationInitialState, fd({ name: "X", items: "{not json" }))).status).toBe("error");
    expect((await createTaskList(automationInitialState, fd({ name: "X", items: '[{"title":""}]' }))).status).toBe("error");
    expect(await prisma.taskList.count()).toBe(0);
  });

  test("archive / restore / delete: gated per key, audited, missing ids are error results", async () => {
    await createTaskList(automationInitialState, fd({ name: "Intake", items }));
    const list = await prisma.taskList.findFirstOrThrow();
    vi.mocked(requirePermission).mockClear();
    expect(await setTaskListActive(list.id, false)).toEqual({ ok: true });
    expect((await prisma.taskList.findUniqueOrThrow({ where: { id: list.id } })).isActive).toBe(false);
    expect(await setTaskListActive("does-not-exist", true)).toEqual({ ok: false, error: "Task list not found." });
    expect(gate()).toEqual(["automations.task_list.edit", "automations.task_list.edit"]);

    vi.mocked(requirePermission).mockClear();
    expect(await deleteTaskList(list.id)).toEqual({ ok: true });
    expect(gate()).toEqual(["automations.task_list.delete"]);
    expect(await deleteTaskList(list.id)).toEqual({ ok: false, error: "Task list not found." });
    expect(await prisma.taskList.count()).toBe(0);
    const titles = (await prisma.activityLog.findMany({ where: { type: "automation" } })).map((l) => l.title);
    expect(titles).toContain("Archived task list: Intake");
    expect(titles).toContain("Deleted task list: Intake");
  });

  test("a denied user cannot archive or delete a list", async () => {
    await createTaskList(automationInitialState, fd({ name: "Intake", items }));
    const list = await prisma.taskList.findFirstOrThrow();
    vi.mocked(requirePermission).mockRejectedValue(new Error("Forbidden"));
    await expect(setTaskListActive(list.id, false)).rejects.toThrow("Forbidden");
    await expect(deleteTaskList(list.id)).rejects.toThrow("Forbidden");
    expect(await prisma.taskList.count()).toBe(1);
    expect((await prisma.taskList.findUniqueOrThrow({ where: { id: list.id } })).isActive).toBe(true);
  });

  test("updating a list deleted after the existence check is a form error, not a thrown P2025", async () => {
    const spy = vi.spyOn(prisma.taskList, "findUnique").mockResolvedValueOnce({ id: "ghost" } as never);
    const res = await updateTaskList("ghost", automationInitialState, fd({ name: "X", items: '[{"title":"A"}]' }));
    spy.mockRestore();
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/not found/i);
    expect(await prisma.taskList.count()).toBe(0);
  });

  test("update replaces items wholesale and leaves already-created tasks alone", async () => {
    await createTaskList(automationInitialState, fd({ name: "Intake", items }));
    const list = await prisma.taskList.findFirstOrThrow();
    await applyTaskListToMatter(matterId, list.id);
    const res = await updateTaskList(list.id, automationInitialState, fd({ name: "Intake v2", items: JSON.stringify([{ title: "Only task" }]) }));
    expect(res.status).toBe("ok");
    expect(await prisma.taskListItem.count()).toBe(1);
    expect(await prisma.task.count({ where: { matterId } })).toBe(2);
  });
});

describe("defaults", () => {
  test("add (deduped) and remove, with readable audit lines", async () => {
    await createDeadlineRule(automationInitialState, ruleForm());
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    const form = () => fd({ practiceAreaId: areaId, target: `rule:${rule.id}` });
    expect((await addAutoApply(automationInitialState, form())).status).toBe("ok");
    expect((await addAutoApply(automationInitialState, form())).errors?.target?.[0]).toMatch(/already/);
    expect(gate()).toContain("automations.defaults.create");

    const row = await prisma.autoApply.findFirstOrThrow();
    expect(row).toMatchObject({ trigger: "matter_created", practiceAreaId: areaId, deadlineRuleId: rule.id, taskListId: null });
    expect((await removeAutoApply(row.id)).ok).toBe(true);
    expect(await prisma.autoApply.count()).toBe(0);
    const titles = (await prisma.activityLog.findMany({ orderBy: { timestamp: "asc" } })).map((l) => l.title);
    expect(titles.some((t) => /will get deadline rule "CGIA notice"/.test(t))).toBe(true);
    expect(titles.some((t) => /no longer get deadline rule "CGIA notice"/.test(t))).toBe(true);
  });

  test("removing the same default twice is an error result, not a thrown P2025", async () => {
    await createDeadlineRule(automationInitialState, ruleForm());
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    await addAutoApply(automationInitialState, fd({ practiceAreaId: areaId, target: `rule:${rule.id}` }));
    const row = await prisma.autoApply.findFirstOrThrow();
    expect((await removeAutoApply(row.id)).ok).toBe(true);
    expect(await removeAutoApply(row.id)).toEqual({ ok: false, error: "Default not found." });
    // The race itself: the row passes the existence check, then vanishes before the delete.
    const gone = await prisma.autoApply.create({ data: { trigger: "matter_created", practiceAreaId: areaId, deadlineRuleId: rule.id } });
    const stale = await prisma.autoApply.findUniqueOrThrow({
      where: { id: gone.id },
      include: {
        practiceArea: { select: { name: true } },
        deadlineRule: { select: { title: true } },
        taskList: { select: { name: true } },
      },
    });
    await prisma.autoApply.delete({ where: { id: gone.id } });
    const spy = vi.spyOn(prisma.autoApply, "findUnique").mockResolvedValueOnce(stale as never);
    expect(await removeAutoApply(gone.id)).toEqual({ ok: false, error: "Default not found." });
    spy.mockRestore();
  });

  test("adding a default whose target is deleted after the existence check is a field error", async () => {
    const spy = vi.spyOn(prisma.deadlineRule, "findUnique").mockResolvedValueOnce({ title: "Ghost" } as never);
    const res = await addAutoApply(automationInitialState, fd({ practiceAreaId: areaId, target: "rule:ghost-id" }));
    spy.mockRestore();
    expect(res.status).toBe("error");
    expect(res.errors?.target?.[0]).toMatch(/no longer exists/);
    expect(await prisma.autoApply.count()).toBe(0);
  });

  test("empty practice area means all areas", async () => {
    await createTaskList(automationInitialState, fd({ name: "Intake", items: '[{"title":"Conflict check"}]' }));
    const list = await prisma.taskList.findFirstOrThrow();
    await addAutoApply(automationInitialState, fd({ practiceAreaId: "", target: `list:${list.id}` }));
    expect((await prisma.autoApply.findFirstOrThrow()).practiceAreaId).toBeNull();
  });
});

describe("manual apply", () => {
  test("rule: ok → duplicate → force; gated on deadlines.create; logged on the matter", async () => {
    await createDeadlineRule(automationInitialState, ruleForm());
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    vi.mocked(requirePermission).mockClear();

    const first = await applyDeadlineRuleToMatter(matterId, rule.id);
    expect(first).toEqual({ status: "ok", title: "CGIA notice", dueKey: "2026-09-08" });
    expect(gate()).toEqual(["deadlines.create"]);
    expect(await applyDeadlineRuleToMatter(matterId, rule.id)).toEqual({ status: "duplicate", title: "CGIA notice" });
    expect((await applyDeadlineRuleToMatter(matterId, rule.id, { force: true })).status).toBe("ok");
    expect(await prisma.deadline.count({ where: { matterId } })).toBe(2);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId, type: "deadline" } });
    expect(log.title).toBe("Applied deadline rule: CGIA notice");
  });

  test("rule: needs_date round-trip with an entered date", async () => {
    await createDeadlineRule(automationInitialState, ruleForm({ title: "Answer due", anchor: "prompt", anchorLabel: "Date of service", amount: "21" }));
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    const ask = await applyDeadlineRuleToMatter(matterId, rule.id);
    expect(ask).toMatchObject({ status: "needs_date", label: "Date of service" });
    expect(await prisma.deadline.count()).toBe(0);
    const done = await applyDeadlineRuleToMatter(matterId, rule.id, { anchorDate: "2026-11-01" });
    expect(done).toMatchObject({ status: "ok", dueKey: "2026-11-22" });
    const d = await prisma.deadline.findFirstOrThrow();
    expect(dateOnlyKey(d.dueDate)).toBe("2026-11-22");
    expect(d.dueDate.toISOString()).toBe("2026-11-22T00:00:00.000Z");
  });

  test("rule: a duplicate that also needs a date works when resent with force AND the date", async () => {
    await createDeadlineRule(automationInitialState, ruleForm({ title: "Answer due", anchor: "prompt", anchorLabel: "Date of service", amount: "21" }));
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    await applyDeadlineRuleToMatter(matterId, rule.id, { anchorDate: "2026-11-01" });
    // Plain re-apply: duplicate (before any date is asked for).
    expect(await applyDeadlineRuleToMatter(matterId, rule.id)).toEqual({ status: "duplicate", title: "Answer due" });
    // Forced without a date: now the date is needed.
    expect(await applyDeadlineRuleToMatter(matterId, rule.id, { force: true })).toMatchObject({ status: "needs_date" });
    // Forced WITH the date: the second deadline is created.
    expect(await applyDeadlineRuleToMatter(matterId, rule.id, { force: true, anchorDate: "2026-12-01" })).toMatchObject({
      status: "ok",
      dueKey: "2026-12-22",
    });
    expect(await prisma.deadline.count({ where: { matterId } })).toBe(2);
  });

  test("rule: incident_date rules without an incident date ask for the 'Incident date'", async () => {
    await prisma.matter.update({ where: { id: matterId }, data: { incidentDate: null } });
    await createDeadlineRule(automationInitialState, ruleForm());
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    expect(await applyDeadlineRuleToMatter(matterId, rule.id)).toMatchObject({
      status: "needs_date",
      label: "Incident date",
    });
  });

  test("rule: a stored absurd offset is an error result, not a thrown 500", async () => {
    const typo = await prisma.deadlineRule.create({
      data: { title: "Typo", anchor: "incident_date", offsetDays: 36500 * 365, offsetUnit: "years" },
    });
    const res = await applyDeadlineRuleToMatter(matterId, typo.id);
    expect(res.status).toBe("error");
    expect(await prisma.deadline.count({ where: { matterId } })).toBe(0);
  });

  test("rule: two simultaneous applies create one deadline (the other sees the duplicate)", async () => {
    await createDeadlineRule(automationInitialState, ruleForm());
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    const results = await Promise.all([
      applyDeadlineRuleToMatter(matterId, rule.id),
      applyDeadlineRuleToMatter(matterId, rule.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["duplicate", "ok"]);
    expect(await prisma.deadline.count({ where: { matterId } })).toBe(1);
  });

  test("task list: two simultaneous applies create one copy", async () => {
    await createTaskList(automationInitialState, fd({ name: "Intake", items: '[{"title":"A"},{"title":"B"}]' }));
    const list = await prisma.taskList.findFirstOrThrow();
    const results = await Promise.all([
      applyTaskListToMatter(matterId, list.id),
      applyTaskListToMatter(matterId, list.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["duplicate", "ok"]);
    expect(await prisma.task.count({ where: { matterId } })).toBe(2);
  });

  test("apply waits on the per-matter advisory lock (proves the lock is taken)", async () => {
    // The app client's pool is capped at 1 connection, so the two "simultaneous"
    // tests above are serialized by the pool and don't prove the lock. Hold the
    // lock from a separate raw connection instead and assert the apply blocks.
    await createDeadlineRule(automationInitialState, ruleForm());
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`automation-apply:${matterId}`]);
      let settled = false;
      const apply = applyDeadlineRuleToMatter(matterId, rule.id).then((r) => {
        settled = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(settled).toBe(false);
      await holder.query("COMMIT"); // releases the xact lock
      expect((await apply).status).toBe("ok");
      expect(await prisma.deadline.count({ where: { matterId } })).toBe(1);
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      await holder.end();
    }
  });

  test("rule: a malformed date is refused before anything runs", async () => {
    await createDeadlineRule(automationInitialState, ruleForm({ anchor: "prompt" }));
    const rule = await prisma.deadlineRule.findFirstOrThrow();
    expect(await applyDeadlineRuleToMatter(matterId, rule.id, { anchorDate: "2026-02-30" })).toEqual({
      status: "error",
      error: "Enter a valid date.",
    });
  });

  test("task list: ok → duplicate → force; gated on tasks.create", async () => {
    await createTaskList(automationInitialState, fd({ name: "Intake", items: '[{"title":"A"},{"title":"B"}]' }));
    const list = await prisma.taskList.findFirstOrThrow();
    vi.mocked(requirePermission).mockClear();
    expect(await applyTaskListToMatter(matterId, list.id)).toEqual({ status: "ok", name: "Intake", count: 2 });
    expect(gate()).toEqual(["tasks.create"]);
    expect(await applyTaskListToMatter(matterId, list.id)).toEqual({ status: "duplicate", name: "Intake" });
    expect((await applyTaskListToMatter(matterId, list.id, { force: true })).status).toBe("ok");
    expect(await prisma.task.count({ where: { matterId } })).toBe(4);
  });
});
