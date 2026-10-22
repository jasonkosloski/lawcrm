/**
 * apply.ts — real DB. Runs in the suite's zone (Denver locally, UTC
 * in the second pass): stored dates must be UTC midnight either way.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { dateOnlyKey } from "@/lib/format-date";
import { applyAutoDefaults, applyDeadlineRules, applyTaskList, describeDefaults } from "./apply";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const TZ = "UTC";
let matterId: string;
let areaId: string;
let leadId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId: leadId } = await seedUser({ firmId }));
  const pa = await seedPracticeArea();
  areaId = pa.areaId;
  ({ matterId } = await seedMatter({
    practiceAreaId: pa.areaId,
    stageId: pa.stageId,
    leadUserId: leadId,
  }));
  await prisma.matter.update({
    where: { id: matterId },
    data: {
      incidentDate: new Date("2026-03-10T00:00:00Z"),
      createdAt: new Date("2026-10-16T12:00:00Z"),
    },
  });
});

const makeRule = (over: Partial<Parameters<typeof prisma.deadlineRule.create>[0]["data"]> = {}) =>
  prisma.deadlineRule.create({
    data: {
      title: "CGIA notice",
      anchor: "incident_date",
      offsetDays: 182,
      offsetUnit: "days",
      ...over,
    },
  });

const dueKeys = async () =>
  (
    await prisma.deadline.findMany({
      where: { matterId },
      orderBy: { dueDate: "asc" },
      select: { title: true, dueDate: true },
    })
  ).map((d) => `${d.title}@${dateOnlyKey(d.dueDate)}`);

describe("applyDeadlineRules", () => {
  test("creates a deadline with provenance, owner, citation, and an explanation", async () => {
    const rule = await makeRule({ sourceRef: "C.R.S. § 24-10-109", kind: "critical" });
    const res = await prisma.$transaction((tx) =>
      applyDeadlineRules(tx, {
        matterId,
        ruleIds: [rule.id],
        tz: TZ,
        onDuplicate: "report",
        onUnplanned: "report",
      }),
    );
    expect(res.created).toHaveLength(1);
    const d = await prisma.deadline.findUniqueOrThrow({ where: { id: res.created[0].deadlineId } });
    expect(dateOnlyKey(d.dueDate)).toBe("2026-09-08");
    // Date-only: UTC midnight, not the server's local midnight.
    expect(d.dueDate.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(d).toMatchObject({
      kind: "critical",
      deadlineRuleId: rule.id,
      ownerId: leadId,
      sourceRef: "C.R.S. § 24-10-109",
      status: "open",
    });
    expect(d.description).toContain("182 days after Incident date (2026-03-10)");
  });

  test("standard rules generate auto_rule deadlines", async () => {
    const rule = await makeRule({ kind: "standard" });
    await prisma.$transaction((tx) =>
      applyDeadlineRules(tx, {
        matterId,
        ruleIds: [rule.id],
        tz: TZ,
        onDuplicate: "report",
        onUnplanned: "report",
      }),
    );
    expect((await prisma.deadline.findFirstOrThrow({ where: { matterId } })).kind).toBe(
      "auto_rule",
    );
  });

  test("duplicates: report writes nothing; create re-applies; skip ignores", async () => {
    const rule = await makeRule();
    const run = (onDuplicate: "report" | "create" | "skip") =>
      prisma.$transaction((tx) =>
        applyDeadlineRules(tx, {
          matterId,
          ruleIds: [rule.id],
          tz: TZ,
          onDuplicate,
          onUnplanned: "report",
        }),
      );
    await run("report");
    const second = await run("report");
    expect(second.duplicates).toEqual([{ ruleId: rule.id, title: "CGIA notice" }]);
    expect(second.created).toHaveLength(0);
    expect(await prisma.deadline.count({ where: { matterId } })).toBe(1);

    expect((await run("skip")).created).toHaveLength(0);
    expect((await run("create")).created).toHaveLength(1);
    expect(await prisma.deadline.count({ where: { matterId } })).toBe(2);
  });

  test("unplanned: report vs a 'Set date' task for the lead", async () => {
    await prisma.matter.update({ where: { id: matterId }, data: { incidentDate: null } });
    const rule = await makeRule();
    const reported = await prisma.$transaction((tx) =>
      applyDeadlineRules(tx, {
        matterId,
        ruleIds: [rule.id],
        tz: TZ,
        onDuplicate: "skip",
        onUnplanned: "report",
      }),
    );
    expect(reported.unplanned[0].reason).toMatch(/no incident date/);
    expect(await prisma.task.count({ where: { matterId } })).toBe(0);

    const tasked = await prisma.$transaction((tx) =>
      applyDeadlineRules(tx, {
        matterId,
        ruleIds: [rule.id],
        tz: TZ,
        onDuplicate: "skip",
        onUnplanned: "task",
      }),
    );
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: tasked.unplanned[0].taskId! },
    });
    expect(task).toMatchObject({
      title: "Set date: CGIA notice",
      ownerId: leadId,
      priority: "urgent",
    });
    expect(await prisma.deadline.count({ where: { matterId } })).toBe(0);
  });

  test("rule anchors chain from deadlines already on the matter", async () => {
    const trial = await makeRule({
      title: "Trial",
      anchor: "prompt",
      anchorLabel: "Trial date",
      offsetDays: 0,
    });
    const motions = await makeRule({
      title: "Motions in limine",
      anchor: "rule",
      anchorRuleId: trial.id,
      offsetDays: -30,
    });
    await prisma.$transaction((tx) =>
      applyDeadlineRules(tx, {
        matterId,
        ruleIds: [trial.id],
        tz: TZ,
        anchorDates: { [trial.id]: "2027-04-15" },
        onDuplicate: "report",
        onUnplanned: "report",
      }),
    );
    await prisma.$transaction((tx) =>
      applyDeadlineRules(tx, {
        matterId,
        ruleIds: [motions.id],
        tz: TZ,
        onDuplicate: "report",
        onUnplanned: "report",
      }),
    );
    expect(await dueKeys()).toEqual(["Motions in limine@2027-03-16", "Trial@2027-04-15"]);
  });

  test("a stored rule with an absurd offset is reported, never thrown (it would block matter creation)", async () => {
    const typo = await makeRule({ title: "Typo", offsetDays: 36500 * 365 });
    const sane = await makeRule({ title: "Sane", offsetDays: 10 });
    const res = await prisma.$transaction((tx) =>
      applyDeadlineRules(tx, {
        matterId,
        ruleIds: [typo.id, sane.id],
        tz: TZ,
        onDuplicate: "skip",
        onUnplanned: "task",
      }),
    );
    expect(res.created.map((c) => c.title)).toEqual(["Sane"]);
    expect(res.unplanned).toMatchObject([{ title: "Typo", code: "out_of_range" }]);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: res.unplanned[0].taskId! } });
    // No date fixes an out-of-range rule: the task must point at the rule, not ask for a date.
    expect(task.title).toBe("Fix rule: Typo");
    expect(task.description).toMatch(/Fix the rule's offset/);
    expect(task.description).not.toMatch(/Once the date is known/);
  });

  test("archived rules are never applied", async () => {
    const rule = await makeRule({ isActive: false });
    const res = await prisma.$transaction((tx) =>
      applyDeadlineRules(tx, {
        matterId,
        ruleIds: [rule.id],
        tz: TZ,
        onDuplicate: "report",
        onUnplanned: "report",
      }),
    );
    expect(res.created).toHaveLength(0);
  });
});

describe("applyTaskList", () => {
  async function makeList() {
    return prisma.taskList.create({
      data: {
        name: "Intake checklist",
        items: {
          create: [
            {
              title: "Send engagement letter",
              assignTo: "lead",
              dueOffsetDays: 3,
              priority: "high",
              sortOrder: 0,
            },
            { title: "Request records", assignTo: "unassigned", dueOffsetDays: null, sortOrder: 1 },
          ],
        },
      },
    });
  }

  test("creates ordered tasks with owners and offsets from today", async () => {
    const list = await makeList();
    const res = await prisma.$transaction((tx) =>
      applyTaskList(tx, {
        matterId,
        taskListId: list.id,
        tz: TZ,
        now: new Date("2026-10-16T15:00:00Z"),
        onDuplicate: "report",
      }),
    );
    expect(res.createdTaskIds).toHaveLength(2);
    const tasks = await prisma.task.findMany({
      where: { matterId },
      orderBy: { sortOrder: "asc" },
    });
    expect(
      tasks.map((t) => [t.title, t.ownerId, t.dueDate && dateOnlyKey(t.dueDate), t.taskListId]),
    ).toEqual([
      ["Send engagement letter", leadId, "2026-10-19", list.id],
      ["Request records", null, null, list.id],
    ]);
    expect(tasks[0].priority).toBe("high");
  });

  test("due dates are date-only (UTC midnight) and the list is appended after existing tasks", async () => {
    const list = await makeList();
    // Hand-made tasks sit at the default sortOrder 0.
    await prisma.task.createMany({
      data: [
        { matterId, title: "Hand-made A", status: "open" },
        { matterId, title: "Hand-made B", status: "open" },
      ],
    });
    await prisma.$transaction((tx) =>
      applyTaskList(tx, {
        matterId,
        taskListId: list.id,
        tz: TZ,
        now: new Date("2026-10-16T15:00:00Z"),
        onDuplicate: "report",
      }),
    );
    const fromList = await prisma.task.findMany({
      where: { matterId, taskListId: list.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(fromList[0].dueDate?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(fromList.map((t) => t.sortOrder)).toEqual([1, 2]);

    // Applying again appends after the first copy instead of colliding.
    await prisma.$transaction((tx) =>
      applyTaskList(tx, { matterId, taskListId: list.id, tz: TZ, onDuplicate: "create" }),
    );
    const both = await prisma.task.findMany({
      where: { matterId, taskListId: list.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(both.map((t) => t.sortOrder)).toEqual([1, 2, 3, 4]);
  });

  test("'today' follows the caller's zone, not the server's", async () => {
    const list = await makeList();
    // 02:00Z Oct 17 is still Oct 16 in Denver (8 PM MDT).
    await prisma.$transaction((tx) =>
      applyTaskList(tx, {
        matterId,
        taskListId: list.id,
        tz: "America/Denver",
        now: new Date("2026-10-17T02:00:00Z"),
        onDuplicate: "report",
      }),
    );
    const t = await prisma.task.findFirstOrThrow({
      where: { matterId, title: "Send engagement letter" },
    });
    expect(dateOnlyKey(t.dueDate!)).toBe("2026-10-19"); // Oct 16 + 3
  });

  test("re-applying reports a duplicate unless forced", async () => {
    const list = await makeList();
    const run = (onDuplicate: "report" | "create") =>
      prisma.$transaction((tx) =>
        applyTaskList(tx, { matterId, taskListId: list.id, tz: TZ, onDuplicate }),
      );
    await run("report");
    const again = await run("report");
    expect(again).toMatchObject({ duplicate: true, createdTaskIds: [] });
    expect((await run("create")).createdTaskIds).toHaveLength(2);
    expect(await prisma.task.count({ where: { matterId } })).toBe(4);
  });
});

describe("applyAutoDefaults", () => {
  test("applies area-specific and all-area defaults, idempotently", async () => {
    const cgia = await makeRule();
    const general = await makeRule({
      title: "Initial client meeting",
      anchor: "matter_opened",
      offsetDays: 7,
    });
    const otherArea = await prisma.practiceArea.create({ data: { name: "Other area" } });
    const elsewhere = await makeRule({ title: "Not for this area" });
    const list = await prisma.taskList.create({
      data: { name: "Intake", items: { create: [{ title: "Conflict check" }] } },
    });
    await prisma.autoApply.createMany({
      data: [
        { practiceAreaId: areaId, deadlineRuleId: cgia.id },
        { practiceAreaId: null, deadlineRuleId: general.id },
        { practiceAreaId: otherArea.id, deadlineRuleId: elsewhere.id },
        { practiceAreaId: null, taskListId: list.id },
      ],
    });

    const run = () =>
      prisma.$transaction((tx) =>
        applyAutoDefaults(tx, {
          matterId,
          practiceAreaId: areaId,
          trigger: "matter_created",
          tz: TZ,
        }),
      );
    const first = await run();
    expect(await dueKeys()).toEqual(
      ["Initial client meeting@2026-10-23", "CGIA notice@2026-09-08"].sort((a, b) =>
        a.split("@")[1].localeCompare(b.split("@")[1]),
      ),
    );
    expect(describeDefaults(first)).toBe(
      "Automatic defaults applied: 2 deadlines, 1 task (Intake)",
    );

    const second = await run();
    expect(describeDefaults(second)).toBeNull();
    expect(await prisma.deadline.count({ where: { matterId } })).toBe(2);
    expect(await prisma.task.count({ where: { matterId } })).toBe(1);
  });

  test("no defaults configured → nothing happens", async () => {
    const res = await prisma.$transaction((tx) =>
      applyAutoDefaults(tx, {
        matterId,
        practiceAreaId: areaId,
        trigger: "matter_created",
        tz: TZ,
      }),
    );
    expect(describeDefaults(res)).toBeNull();
  });
});
