/**
 * Integration tests for the practice-area / stage actions.
 *
 * Pins:
 *   - turning SOL tracking OFF keeps the stored period + citation (so
 *     re-enabling restores them) and does not touch matters' SOL dates
 *     or SOL deadlines
 *   - turning it ON writes the packed period + citation
 *   - every mutation writes a firm-level "settings" audit row, with a
 *     before -> after diff for updates and none when nothing changed
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  createStage,
  movePracticeArea,
  setPracticeAreaActive,
  updatePracticeArea,
  updateStage,
} from "@/app/actions/practice-areas";
import { practiceAreaInitialState } from "@/lib/practice-area-constants";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let areaId: string;
let stageId: string;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const areaForm = (over: Record<string, string> = {}) =>
  form({
    name: "Section 1983",
    label: "",
    color: "#2563a8",
    defaultBillingMode: "client",
    ...over,
  });

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId })).userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);
  const a = await seedPracticeArea({
    name: "Section 1983",
    hasStatuteOfLimitations: true,
  });
  areaId = a.areaId;
  stageId = a.stageId;
  await prisma.practiceArea.update({
    where: { id: areaId },
    data: {
      statutePeriodDays: 730,
      statuteSourceCitation: "C.R.S. § 13-80-102",
    },
  });
});

describe("updatePracticeArea SOL toggle", () => {
  test("turning SOL off keeps the period + citation and leaves matters' SOL data alone", async () => {
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: { statuteOfLimitationsDate: new Date("2027-01-10") },
    });
    await prisma.deadline.create({
      data: {
        matterId,
        title: "Statute of limitations",
        dueDate: new Date("2027-01-10"),
        kind: "critical",
        sourceType: "statute_of_limitations",
      },
    });

    // Checkbox absent from FormData = unchecked; the typed period is
    // ignored while tracking is off.
    const res = await updatePracticeArea(
      areaId,
      practiceAreaInitialState,
      areaForm({ statuteYears: "9" })
    );
    expect(res.status).toBe("ok");

    const area = await prisma.practiceArea.findUniqueOrThrow({
      where: { id: areaId },
    });
    expect(area.hasStatuteOfLimitations).toBe(false);
    expect(area.statutePeriodDays).toBe(730);
    expect(area.statuteSourceCitation).toBe("C.R.S. § 13-80-102");
    const m = await prisma.matter.findUniqueOrThrow({
      where: { id: matterId },
    });
    expect(m.statuteOfLimitationsDate).not.toBeNull();
    expect(
      await prisma.deadline.count({
        where: { matterId, sourceType: "statute_of_limitations" },
      })
    ).toBe(1);
  });

  test("turning SOL on writes the packed period and citation", async () => {
    const res = await updatePracticeArea(
      areaId,
      practiceAreaInitialState,
      areaForm({
        hasStatuteOfLimitations: "on",
        statuteYears: "3",
        statuteMonths: "0",
        statuteDays: "5",
        statuteSourceCitation: "C.R.S. § 13-80-101",
      })
    );
    expect(res.status).toBe("ok");
    const area = await prisma.practiceArea.findUniqueOrThrow({
      where: { id: areaId },
    });
    expect(area.hasStatuteOfLimitations).toBe(true);
    expect(area.statutePeriodDays).toBe(3 * 365 + 5);
    expect(area.statuteSourceCitation).toBe("C.R.S. § 13-80-101");
  });
});

describe("audit entries", () => {
  test("an update logs a before -> after diff naming who changed it", async () => {
    await updatePracticeArea(
      areaId,
      practiceAreaInitialState,
      areaForm({ statuteYears: "9" }) // SOL left unchecked => on -> off
    );
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { type: "settings" },
    });
    expect(entry.matterId).toBeNull();
    expect(entry.userId).toBe(userId);
    expect(entry.title).toBe("Practice area updated — Section 1983");
    expect(entry.detail).toContain("SOL tracking on → off");
  });

  test("an update that changes nothing writes no row", async () => {
    await updatePracticeArea(
      areaId,
      practiceAreaInitialState,
      areaForm({
        hasStatuteOfLimitations: "on",
        statuteYears: "2",
        statuteSourceCitation: "C.R.S. § 13-80-102",
      })
    );
    expect(await prisma.activityLog.count({ where: { type: "settings" } })).toBe(
      0
    );
  });

  test("stage terminal flip, archive and area move are logged", async () => {
    const fd = form({ name: "Intake", isTerminal: "on" });
    await updateStage(stageId, { status: "idle" }, fd);
    const stageEntry = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Stage updated — Intake" },
    });
    expect(stageEntry.detail).toContain("terminal no → yes");

    await createStage(areaId, { status: "idle" }, form({ name: "Discovery" }));
    expect(
      await prisma.activityLog.count({
        where: { title: "Stage created — Discovery" },
      })
    ).toBe(1);

    await setPracticeAreaActive(areaId, false);
    expect(
      await prisma.activityLog.count({
        where: { title: "Practice area archived — Section 1983" },
      })
    ).toBe(1);

    await seedPracticeArea({ name: "Other" });
    await movePracticeArea(areaId, "down");
    expect(
      await prisma.activityLog.count({
        where: { type: "settings", title: { startsWith: "Practice area moved" } },
      })
    ).toBe(1);
  });
});
