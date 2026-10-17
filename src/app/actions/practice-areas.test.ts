/**
 * Integration tests for the practice-area + stage actions.
 *
 * Pins: the default 10-stage seed (last two terminal), name collisions
 * (active and archived), SOL packing / nulling / keep-on-uncheck, the
 * archive guards, reorder among VISIBLE rows only (an archived sibling
 * in between must not swallow a click), duplicate-order renumbering,
 * recolour propagation to matters still on the old colour, audit rows,
 * and the permission gate on every export.
 *
 * Auth is stubbed; the gate itself is covered in
 * `permission-check.integration.test.ts`.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import {
  createPracticeArea,
  createStage,
  movePracticeArea,
  moveStage,
  setPracticeAreaActive,
  setStageActive,
  updatePracticeArea,
  updateStage,
} from "@/app/actions/practice-areas";
import {
  practiceAreaInitialState,
  stageInitialState,
} from "@/lib/practice-area-constants";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedRequire = vi.mocked(requirePermission);

let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  userId = (await seedUser({ firmId: f.firmId })).userId;
  mockedRequire.mockReset();
  mockedRequire.mockResolvedValue(userId);
});

function areaForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("name", "Employment");
  fd.set("color", "#2563a8");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

async function create(over: Record<string, string> = {}) {
  let url = "";
  try {
    await createPracticeArea(practiceAreaInitialState, areaForm(over));
  } catch (e) {
    url = (e as Error).message.replace("__REDIRECT__:", "");
  }
  return url;
}

async function areaIdByName(name: string) {
  return (await prisma.practiceArea.findUniqueOrThrow({ where: { name } })).id;
}

/** An area with N named active stages in order. */
async function areaWithStages(name: string, stageNames: string[]) {
  const area = await prisma.practiceArea.create({
    data: {
      name,
      stages: {
        create: stageNames.map((n, i) => ({ name: n, order: i })),
      },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  return area;
}

const activeStageNames = async (practiceAreaId: string) =>
  (
    await prisma.matterStage.findMany({
      where: { practiceAreaId, isActive: true },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    })
  ).map((s) => s.name);

describe("createPracticeArea", () => {
  test("seeds the 10 default stages (last two terminal) and redirects to the detail page", async () => {
    const url = await create();
    const area = await prisma.practiceArea.findUniqueOrThrow({
      where: { name: "Employment" },
      include: { stages: { orderBy: { order: "asc" } } },
    });
    expect(url).toBe(`/settings/practice-areas/${area.id}`);
    expect(area.stages).toHaveLength(10);
    expect(area.stages.map((s) => s.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(area.stages.filter((s) => s.isTerminal).map((s) => s.name)).toEqual([
      "Settled",
      "Closed",
    ]);
  });

  test("SOL on: 2 years stores amount + unit (not days) and the citation", async () => {
    await create({
      hasStatuteOfLimitations: "on",
      statutePeriodAmount: "2",
      statutePeriodUnit: "YEARS",
      statuteSourceCitation: " 42 U.S.C. § 1983 ",
    });
    const area = await prisma.practiceArea.findUniqueOrThrow({
      where: { name: "Employment" },
    });
    expect(area.hasStatuteOfLimitations).toBe(true);
    expect(area.statutePeriodAmount).toBe(2);
    expect(area.statutePeriodUnit).toBe("YEARS");
    expect(area.statutePeriodDays).toBeNull();
    expect(area.statuteSourceCitation).toBe("42 U.S.C. § 1983");
  });

  test("SOL on with a blank period stores null; SOL off ignores a posted period", async () => {
    await create({ hasStatuteOfLimitations: "on" });
    expect(
      (await prisma.practiceArea.findUniqueOrThrow({ where: { name: "Employment" } }))
        .statutePeriodAmount
    ).toBeNull();

    await create({
      name: "Housing",
      statutePeriodAmount: "3",
      statutePeriodUnit: "YEARS",
      statuteSourceCitation: "x",
    });
    const off = await prisma.practiceArea.findUniqueOrThrow({
      where: { name: "Housing" },
    });
    expect(off.hasStatuteOfLimitations).toBe(false);
    expect(off.statutePeriodAmount).toBeNull();
    expect(off.statutePeriodUnit).toBeNull();
    expect(off.statuteSourceCitation).toBeNull();
  });

  test("appends after the highest existing order", async () => {
    await prisma.practiceArea.create({ data: { name: "Old", order: 7 } });
    await create();
    expect(
      (await prisma.practiceArea.findUniqueOrThrow({ where: { name: "Employment" } }))
        .order
    ).toBe(8);
  });

  test("rejects a duplicate name, active or archived, without creating", async () => {
    await prisma.practiceArea.create({ data: { name: "Employment" } });
    const res = await createPracticeArea(practiceAreaInitialState, areaForm());
    expect(res.status).toBe("error");
    expect(res.errors?.name?.[0]).toMatch(/already exists/);
    expect(res.values?.name).toBe("Employment");

    await prisma.practiceArea.update({
      where: { name: "Employment" },
      data: { isActive: false },
    });
    const res2 = await createPracticeArea(practiceAreaInitialState, areaForm());
    expect(res2.errors?.name?.[0]).toMatch(/archived/);
    expect(await prisma.practiceArea.count()).toBe(1);
  });

  test("SOL period: months and days store as typed; a bad amount or missing unit is a field error", async () => {
    await create({
      hasStatuteOfLimitations: "on",
      statutePeriodAmount: "18",
      statutePeriodUnit: "MONTHS",
    });
    const a = await prisma.practiceArea.findUniqueOrThrow({
      where: { name: "Employment" },
    });
    expect([a.statutePeriodAmount, a.statutePeriodUnit]).toEqual([18, "MONTHS"]);

    for (const bad of ["0", "-3", "1.5", "abc"]) {
      const res = await createPracticeArea(
        practiceAreaInitialState,
        areaForm({
          name: `Bad ${bad}`,
          hasStatuteOfLimitations: "on",
          statutePeriodAmount: bad,
          statutePeriodUnit: "DAYS",
        })
      );
      expect(res.status).toBe("error");
      expect(res.errors?.statutePeriodAmount).toBeTruthy();
    }
    const noUnit = await createPracticeArea(
      practiceAreaInitialState,
      areaForm({
        name: "No unit",
        hasStatuteOfLimitations: "on",
        statutePeriodAmount: "2",
      })
    );
    expect(noUnit.errors?.statutePeriodUnit).toBeTruthy();
    expect(await prisma.practiceArea.count()).toBe(1);
  });

  test("validates name + colour", async () => {
    const res = await createPracticeArea(
      practiceAreaInitialState,
      areaForm({ name: " ", color: "blue" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.name).toBeTruthy();
    expect(res.errors?.color).toBeTruthy();
  });
});

describe("updatePracticeArea", () => {
  test("rewrites the SOL period when on, keeps it when unchecked, and audits old -> new", async () => {
    await create({
      hasStatuteOfLimitations: "on",
      statutePeriodAmount: "2",
      statutePeriodUnit: "YEARS",
    });
    const id = await areaIdByName("Employment");

    const fd = areaForm({
      hasStatuteOfLimitations: "on",
      statutePeriodAmount: "3",
      statutePeriodUnit: "YEARS",
      statuteSourceCitation: "C.R.S. § 13-80-101",
    });
    expect((await updatePracticeArea(id, practiceAreaInitialState, fd)).status).toBe(
      "ok"
    );
    let area = await prisma.practiceArea.findUniqueOrThrow({ where: { id } });
    expect(area.statutePeriodAmount).toBe(3);
    expect(area.statutePeriodUnit).toBe("YEARS");
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Practice area updated — Employment" },
    });
    expect(log.detail).toContain("SOL period 2 years → 3 years");

    // Unchecking tracking stops computing but keeps the stored period.
    await updatePracticeArea(id, practiceAreaInitialState, areaForm());
    area = await prisma.practiceArea.findUniqueOrThrow({ where: { id } });
    expect(area.hasStatuteOfLimitations).toBe(false);
    expect(area.statutePeriodAmount).toBe(3);
    expect(area.statutePeriodUnit).toBe("YEARS");
    expect(area.statuteSourceCitation).toBe("C.R.S. § 13-80-101");
  });

  test("rejects a name used by another area", async () => {
    await prisma.practiceArea.create({ data: { name: "Housing" } });
    await create();
    const id = await areaIdByName("Employment");
    const res = await updatePracticeArea(
      id,
      practiceAreaInitialState,
      areaForm({ name: "Housing" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.name?.[0]).toMatch(/already uses/);
  });

  test("a recolour reaches matters on the old colour but not per-matter overrides", async () => {
    const { areaId, stageId } = await seedPracticeArea({ name: "Employment" });
    await prisma.practiceArea.update({
      where: { id: areaId },
      data: { color: "#2563A8" },
    });
    const a = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Follows area",
    });
    const b = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Override",
    });
    await prisma.matter.update({
      where: { id: a.matterId },
      data: { color: "#2563a8" }, // same colour, different hex case
    });
    await prisma.matter.update({
      where: { id: b.matterId },
      data: { color: "#ff0000" },
    });

    await updatePracticeArea(
      areaId,
      practiceAreaInitialState,
      areaForm({ color: "#7c3aed" })
    );

    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: a.matterId } })).color
    ).toBe("#7c3aed");
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: b.matterId } })).color
    ).toBe("#ff0000");
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Practice area updated — Employment" },
    });
    expect(log.detail).toContain("1 matter recoloured");
  });
});

describe("setPracticeAreaActive / setStageActive guards", () => {
  test("archive is blocked while matters remain (message tells the admin to MOVE them), allowed once empty, restorable", async () => {
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });

    const blocked = await setPracticeAreaActive(areaId, false);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/^Cannot archive/);
    expect(blocked.error).toMatch(/1 matter /);
    expect(blocked.error).toMatch(/Move them/);
    expect(blocked.error).not.toMatch(/archive the matters/);

    const stageBlocked = await setStageActive(stageId, false);
    expect(stageBlocked.ok).toBe(false);

    await prisma.matter.delete({ where: { id: matterId } });
    expect((await setStageActive(stageId, false)).ok).toBe(true);
    expect((await setPracticeAreaActive(areaId, false)).ok).toBe(true);
    expect(
      (await prisma.practiceArea.findUniqueOrThrow({ where: { id: areaId } }))
        .isActive
    ).toBe(false);
    expect((await setPracticeAreaActive(areaId, true)).ok).toBe(true);
  });
});

describe("movePracticeArea", () => {
  async function threeAreas() {
    const a = await prisma.practiceArea.create({ data: { name: "A", order: 0 } });
    const b = await prisma.practiceArea.create({ data: { name: "B", order: 1 } });
    const c = await prisma.practiceArea.create({ data: { name: "C", order: 2 } });
    return { a, b, c };
  }
  const visible = async () =>
    (
      await prisma.practiceArea.findMany({
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      })
    ).map((x) => x.name);

  test("swaps with the adjacent visible area", async () => {
    const { b } = await threeAreas();
    await movePracticeArea(b.id, "up");
    expect(await visible()).toEqual(["B", "A", "C"]);
  });

  test("skips an archived area sitting between two visible ones", async () => {
    const { b, c } = await threeAreas();
    await prisma.practiceArea.update({
      where: { id: b.id },
      data: { isActive: false },
    });
    // Visible: A, C. Moving C up must put it before A (old code swapped
    // with the hidden B and nothing visibly changed).
    await movePracticeArea(c.id, "up");
    expect(await visible()).toEqual(["C", "A"]);
    // The archived row keeps its own position value.
    expect(
      (await prisma.practiceArea.findUniqueOrThrow({ where: { id: b.id } })).order
    ).toBe(1);
  });

  test("the edges are no-ops (no swap with an archived neighbour)", async () => {
    const { a, b, c } = await threeAreas();
    await prisma.practiceArea.update({
      where: { id: c.id },
      data: { isActive: false },
    });
    expect((await movePracticeArea(b.id, "down")).ok).toBe(true);
    expect((await movePracticeArea(a.id, "up")).ok).toBe(true);
    expect(await visible()).toEqual(["A", "B"]);
    expect(
      (await prisma.practiceArea.findUniqueOrThrow({ where: { id: c.id } })).order
    ).toBe(2);
  });

  test("equal order values still produce a visible swap (renumbered)", async () => {
    const a = await prisma.practiceArea.create({ data: { name: "A", order: 0 } });
    const b = await prisma.practiceArea.create({ data: { name: "B", order: 0 } });
    const before = await visible();
    const second = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1))[1];
    await movePracticeArea(second.id, "up");
    expect(await visible()).not.toEqual(before);
    expect(await visible()).toHaveLength(2);
  });

  test("moving an archived or unknown area changes nothing", async () => {
    const { a } = await threeAreas();
    await prisma.practiceArea.update({
      where: { id: a.id },
      data: { isActive: false },
    });
    expect((await movePracticeArea(a.id, "down")).ok).toBe(true);
    expect((await movePracticeArea("nope", "down")).ok).toBe(false);
    expect(await visible()).toEqual(["B", "C"]);
  });
});

describe("stages", () => {
  test("moveStage skips an archived stage between two visible ones", async () => {
    const area = await areaWithStages("Area", ["Intake", "Cert", "Trial"]);
    const [, cert, trial] = area.stages;
    await prisma.matterStage.update({
      where: { id: cert.id },
      data: { isActive: false },
    });
    await moveStage(trial.id, "up");
    expect(await activeStageNames(area.id)).toEqual(["Trial", "Intake"]);
    // Boundary click: Trial is now first; moving up again does nothing.
    await moveStage(trial.id, "up");
    expect(await activeStageNames(area.id)).toEqual(["Trial", "Intake"]);
  });

  test("moveStage on an archived or missing stage changes nothing", async () => {
    const area = await areaWithStages("Area", ["One", "Two"]);
    await prisma.matterStage.update({
      where: { id: area.stages[0].id },
      data: { isActive: false },
    });
    expect((await moveStage(area.stages[0].id, "down")).ok).toBe(true);
    expect((await moveStage("nope", "down")).ok).toBe(false);
    expect(await activeStageNames(area.id)).toEqual(["Two"]);
  });

  test("createStage appends, flags terminal, and rejects a duplicate name (including archived)", async () => {
    const area = await areaWithStages("Area", ["One", "Two"]);
    const fd = new FormData();
    fd.set("name", "Closed out");
    fd.set("isTerminal", "on");
    expect((await createStage(area.id, stageInitialState, fd)).status).toBe("ok");
    const added = await prisma.matterStage.findFirstOrThrow({
      where: { practiceAreaId: area.id, name: "Closed out" },
    });
    expect(added.order).toBe(2);
    expect(added.isTerminal).toBe(true);

    await prisma.matterStage.update({
      where: { id: area.stages[0].id },
      data: { isActive: false },
    });
    const dup = new FormData();
    dup.set("name", "One");
    const res = await createStage(area.id, stageInitialState, dup);
    expect(res.status).toBe("error");
    expect(res.errors?.name?.[0]).toMatch(/already exists/);
  });

  test("updateStage renames, toggles terminal, audits, and rejects a sibling's name", async () => {
    const area = await areaWithStages("Area", ["One", "Two"]);
    const [one] = area.stages;
    const fd = new FormData();
    fd.set("name", "Uno");
    fd.set("isTerminal", "on");
    expect((await updateStage(one.id, stageInitialState, fd)).status).toBe("ok");
    const row = await prisma.matterStage.findUniqueOrThrow({ where: { id: one.id } });
    expect(row.name).toBe("Uno");
    expect(row.isTerminal).toBe(true);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Stage updated — Uno" },
    });
    expect(log.detail).toContain("terminal no → yes");

    const clash = new FormData();
    clash.set("name", "Two");
    const res = await updateStage(one.id, stageInitialState, clash);
    expect(res.status).toBe("error");
  });
});

describe("permission gate", () => {
  test("every export requires firm.manage_practice_areas and does nothing when denied", async () => {
    mockedRequire.mockRejectedValue(new Error("__DENIED__"));
    const area = await areaWithStages("Area", ["One", "Two"]);

    const calls: Array<() => Promise<unknown>> = [
      () => createPracticeArea(practiceAreaInitialState, areaForm({ name: "X" })),
      () => updatePracticeArea(area.id, practiceAreaInitialState, areaForm({ name: "Y" })),
      () => setPracticeAreaActive(area.id, false),
      () => movePracticeArea(area.id, "down"),
      () => createStage(area.id, stageInitialState, new FormData()),
      () => updateStage(area.stages[0].id, stageInitialState, new FormData()),
      () => setStageActive(area.stages[0].id, false),
      () => moveStage(area.stages[0].id, "down"),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow("__DENIED__");
    }
    for (const c of mockedRequire.mock.calls) {
      expect(c[0]).toBe("firm.manage_practice_areas");
    }
    expect(mockedRequire).toHaveBeenCalledTimes(calls.length);
    expect(await prisma.practiceArea.count()).toBe(1);
    expect(await prisma.practiceArea.count({ where: { isActive: false } })).toBe(0);
    expect(await activeStageNames(area.id)).toEqual(["One", "Two"]);
  });
});
