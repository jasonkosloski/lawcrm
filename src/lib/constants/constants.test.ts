/**
 * Smoke tests for the centralized status/priority/stage constants.
 * Contract: every value set is duplicate-free, every label map
 * covers its value set exactly, and the derived subsets stay
 * subsets of their parent set. Catches the "added a status, forgot
 * the label" class of drift at commit time.
 */

import { describe, expect, test } from "vitest";
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  TASK_CLOSED_STATUSES,
  isTaskClosed,
} from "./task-status";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "./priority";
import {
  DEADLINE_STATUSES,
  ALL_DEADLINE_STATUSES,
  DEADLINE_STATUS_LABEL,
  DEADLINE_KINDS,
  DEADLINE_KIND_LABEL,
} from "./deadline-status";
import {
  TIME_ENTRY_STATUSES,
  TIME_ENTRY_STATUS_LABEL,
  TIME_ENTRY_WIP_STATUSES,
} from "./time-entry-status";
import {
  LEAD_STAGES,
  LEAD_STAGE_ORDER,
  LEAD_STAGE_LABEL,
  LEAD_OPEN_STAGES,
  LEAD_CLOSED_STAGES,
} from "./lead-stage";
import {
  INVOICE_STATUSES,
  INVOICE_KINDS,
  INVOICE_KIND_LABEL,
} from "./invoice-status";
import { EVENT_TYPES, EVENT_TYPE_LABEL } from "./calendar-event-type";
import {
  FLAG_CATEGORIES,
  FLAG_CATEGORY_LABEL,
  FLAG_CATEGORY_TONE,
  FLAG_TONE_CHIP_CLASS,
  flagCategoryChipClass,
} from "./flag-category";
import {
  SETTLEMENT_STATUSES,
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_LIEN_STATUSES,
  SETTLEMENT_LIEN_STATUS_LABEL,
  SETTLEMENT_APPROVAL_STATUSES,
} from "./settlement-status";

function expectNoDuplicates(values: readonly string[]) {
  expect(new Set(values).size).toBe(values.length);
}

function expectLabelsCover(
  values: readonly string[],
  labels: Record<string, string>
) {
  expect(Object.keys(labels).sort()).toEqual([...values].sort());
  for (const v of values) {
    expect(labels[v]).toBeTruthy();
    // Labels are human text, not raw slugs.
    expect(labels[v]).not.toMatch(/_/);
  }
}

describe("task status", () => {
  test("no duplicates, labels cover", () => {
    expectNoDuplicates(TASK_STATUSES);
    expectLabelsCover(TASK_STATUSES, TASK_STATUS_LABEL);
  });

  test("closed statuses are a subset", () => {
    for (const s of TASK_CLOSED_STATUSES) {
      expect(TASK_STATUSES).toContain(s);
    }
  });

  test("isTaskClosed", () => {
    expect(isTaskClosed("done")).toBe(true);
    expect(isTaskClosed("cancelled")).toBe(true);
    expect(isTaskClosed("open")).toBe(false);
    expect(isTaskClosed("in_progress")).toBe(false);
    expect(isTaskClosed("bogus")).toBe(false);
  });
});

describe("task priority", () => {
  test("no duplicates, labels cover", () => {
    expectNoDuplicates(TASK_PRIORITIES);
    expectLabelsCover(TASK_PRIORITIES, TASK_PRIORITY_LABEL);
  });
});

describe("deadline status + kind", () => {
  test("settable statuses are a subset of all statuses", () => {
    expectNoDuplicates(DEADLINE_STATUSES);
    expectNoDuplicates(ALL_DEADLINE_STATUSES);
    for (const s of DEADLINE_STATUSES) {
      expect(ALL_DEADLINE_STATUSES).toContain(s);
    }
    // "overdue" is derived-only — renderable, never settable.
    expect(ALL_DEADLINE_STATUSES).toContain("overdue");
    expect(DEADLINE_STATUSES).not.toContain("overdue");
  });

  test("labels cover every renderable status + every kind", () => {
    expectLabelsCover(ALL_DEADLINE_STATUSES, DEADLINE_STATUS_LABEL);
    expectNoDuplicates(DEADLINE_KINDS);
    expectLabelsCover(DEADLINE_KINDS, DEADLINE_KIND_LABEL);
  });
});

describe("time-entry status", () => {
  test("no duplicates, labels cover", () => {
    expectNoDuplicates(TIME_ENTRY_STATUSES);
    expectLabelsCover(TIME_ENTRY_STATUSES, TIME_ENTRY_STATUS_LABEL);
  });

  test("WIP statuses are a subset and exclude billed / written_off", () => {
    for (const s of TIME_ENTRY_WIP_STATUSES) {
      expect(TIME_ENTRY_STATUSES).toContain(s);
    }
    expect(TIME_ENTRY_WIP_STATUSES).not.toContain("billed");
    expect(TIME_ENTRY_WIP_STATUSES).not.toContain("written_off");
  });
});

describe("lead stage", () => {
  test("no duplicates, labels cover", () => {
    expectNoDuplicates(LEAD_STAGES);
    expectLabelsCover(LEAD_STAGES, LEAD_STAGE_LABEL);
  });

  test("order / open / closed partitions cover the full set", () => {
    expect([...LEAD_STAGE_ORDER].sort()).toEqual([...LEAD_STAGES].sort());
    expect([...LEAD_OPEN_STAGES, ...LEAD_CLOSED_STAGES].sort()).toEqual(
      [...LEAD_STAGES].sort()
    );
  });
});

describe("invoice status + kind", () => {
  test("no duplicates, kind labels cover", () => {
    expectNoDuplicates(INVOICE_STATUSES);
    expectNoDuplicates(INVOICE_KINDS);
    expectLabelsCover(INVOICE_KINDS, INVOICE_KIND_LABEL);
  });
});

describe("calendar event type", () => {
  test("no duplicates, labels cover", () => {
    expectNoDuplicates(EVENT_TYPES);
    expectLabelsCover(EVENT_TYPES, EVENT_TYPE_LABEL);
  });
});

describe("flag category", () => {
  test("no duplicates, labels cover", () => {
    expectNoDuplicates(FLAG_CATEGORIES);
    expectLabelsCover(FLAG_CATEGORIES, FLAG_CATEGORY_LABEL);
  });

  test("every category has a tone and every tone has chip classes", () => {
    expect(Object.keys(FLAG_CATEGORY_TONE).sort()).toEqual(
      [...FLAG_CATEGORIES].sort()
    );
    for (const c of FLAG_CATEGORIES) {
      const tone = FLAG_CATEGORY_TONE[c];
      expect(FLAG_TONE_CHIP_CLASS[tone]).toBeTruthy();
      expect(flagCategoryChipClass(c)).toBe(FLAG_TONE_CHIP_CLASS[tone]);
    }
  });

  test("tones follow the review vocabulary (warn / brand / neutral)", () => {
    expect(FLAG_CATEGORY_TONE.critical).toBe("warn");
    expect(FLAG_CATEGORY_TONE.use_of_force).toBe("warn");
    expect(FLAG_CATEGORY_TONE.miranda).toBe("brand");
    expect(FLAG_CATEGORY_TONE.contradiction).toBe("brand");
    expect(FLAG_CATEGORY_TONE.emphasis).toBe("neutral");
    expect(FLAG_CATEGORY_TONE.anomaly).toBe("neutral");
  });
});

describe("settlement statuses", () => {
  test("no duplicates, labels cover", () => {
    expectNoDuplicates(SETTLEMENT_STATUSES);
    expectLabelsCover(SETTLEMENT_STATUSES, SETTLEMENT_STATUS_LABEL);
    expectNoDuplicates(SETTLEMENT_LIEN_STATUSES);
    expectLabelsCover(SETTLEMENT_LIEN_STATUSES, SETTLEMENT_LIEN_STATUS_LABEL);
    expectNoDuplicates(SETTLEMENT_APPROVAL_STATUSES);
  });
});
