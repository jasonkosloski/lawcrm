import { describe, expect, test } from "vitest";
import { planRecalc, type RecalcDeadline, type RecalcRule } from "./recalc-plan";

const rule = (id: string, over: Partial<RecalcRule> = {}): RecalcRule => ({
  id,
  title: id,
  anchor: "rule",
  anchorRuleId: null,
  offsetDays: 0,
  offsetUnit: "days",
  ...over,
});

let t = 0;
const dl = (
  id: string,
  ruleId: string | null,
  dueKey: string,
  over: Partial<RecalcDeadline> = {},
): RecalcDeadline => ({
  id,
  title: id,
  status: "open",
  dueKey,
  ruleId,
  createdAtMs: ++t,
  manual: false,
  ...over,
});

// Trial (entered) → Pretrial order (-60d) → Motions (-30d from pretrial)
const rules = [
  rule("trial", { anchor: "prompt" }),
  rule("pretrial", { anchorRuleId: "trial", offsetDays: -60 }),
  rule("motions", { anchorRuleId: "pretrial", offsetDays: -30 }),
];
const chain = () => [
  dl("d-trial", "trial", "2027-06-01"),
  dl("d-pretrial", "pretrial", "2027-04-02"),
  dl("d-motions", "motions", "2027-03-03"),
];
const moves = (cs: ReturnType<typeof planRecalc>) =>
  cs.map((c) => `${c.deadlineId}:${c.fromKey}→${c.toKey}`);

describe("planRecalc — deadline moved", () => {
  test("follows the whole chain, in order, with the anchor of each step", () => {
    const cs = planRecalc(chain(), rules, {
      kind: "deadline",
      deadlineId: "d-trial",
      newDueKey: "2027-07-01",
    });
    expect(moves(cs)).toEqual([
      "d-pretrial:2027-04-02→2027-05-02",
      "d-motions:2027-03-03→2027-04-02",
    ]);
    expect(cs.map((c) => [c.anchorDeadlineId, c.anchorText])).toEqual([
      [null, "d-trial"],
      ["d-pretrial", "d-pretrial"],
    ]);
  });

  test("nothing depends on a deadline without a rule, or on an unchanged date", () => {
    expect(
      planRecalc([dl("x", null, "2027-01-01")], rules, {
        kind: "deadline",
        deadlineId: "x",
        newDueKey: "2027-02-01",
      }),
    ).toEqual([]);
    expect(
      planRecalc(chain(), rules, {
        kind: "deadline",
        deadlineId: "d-trial",
        newDueKey: "2027-06-01",
      }),
    ).toEqual([]);
  });

  test("completed / waived deadlines stay put, and so does what counts from them", () => {
    const ds = chain().map((d) => (d.id === "d-pretrial" ? { ...d, status: "completed" } : d));
    expect(
      planRecalc(ds, rules, { kind: "deadline", deadlineId: "d-trial", newDueKey: "2027-07-01" }),
    ).toEqual([]);
  });

  test("hand-set dates are listed, flagged", () => {
    const ds = chain().map((d) =>
      d.id === "d-motions" ? { ...d, manual: true, dueKey: "2027-03-10" } : d,
    );
    const cs = planRecalc(ds, rules, {
      kind: "deadline",
      deadlineId: "d-trial",
      newDueKey: "2027-07-01",
    });
    expect(cs.find((c) => c.deadlineId === "d-motions")).toMatchObject({
      manual: true,
      fromKey: "2027-03-10",
      toKey: "2027-04-02",
    });
  });

  test("unticking a deadline keeps it AND everything counting from it", () => {
    const cs = planRecalc(
      chain(),
      rules,
      { kind: "deadline", deadlineId: "d-trial", newDueKey: "2027-07-01" },
      {
        selected: new Set(["d-motions"]),
      },
    );
    expect(cs).toEqual([]);
    const onlyFirst = planRecalc(
      chain(),
      rules,
      { kind: "deadline", deadlineId: "d-trial", newDueKey: "2027-07-01" },
      {
        selected: new Set(["d-pretrial"]),
      },
    );
    expect(moves(onlyFirst)).toEqual(["d-pretrial:2027-04-02→2027-05-02"]);
  });

  test("only a rule's newest deadline anchors its dependents", () => {
    const ds = [dl("old-trial", "trial", "2027-01-01"), ...chain()]; // chain's d-trial is newer
    expect(
      planRecalc(ds, rules, { kind: "deadline", deadlineId: "old-trial", newDueKey: "2027-02-01" }),
    ).toEqual([]);
  });

  test("calendar-month offsets match applying the rule fresh (Jan 31 + 1 month = Feb 28)", () => {
    const rs = [
      rule("a", { anchor: "prompt" }),
      rule("b", { anchorRuleId: "a", offsetDays: 30, offsetUnit: "months" }),
    ];
    const ds = [dl("da", "a", "2027-01-15"), dl("db", "b", "2027-02-15")];
    expect(
      moves(planRecalc(ds, rs, { kind: "deadline", deadlineId: "da", newDueKey: "2027-01-31" })),
    ).toEqual(["db:2027-02-15→2027-02-28"]);
  });

  test("a stored loop can't recurse forever", () => {
    const rs = [rule("a", { anchorRuleId: "b" }), rule("b", { anchorRuleId: "a" })];
    const ds = [dl("da", "a", "2027-01-01"), dl("db", "b", "2027-01-01")];
    expect(() =>
      planRecalc(ds, rs, { kind: "deadline", deadlineId: "da", newDueKey: "2027-02-01" }),
    ).not.toThrow();
  });
});

describe("planRecalc — incident date moved", () => {
  test("moves incident-anchored deadlines and their chains", () => {
    const rs = [
      rule("cgia", { anchor: "incident_date", offsetDays: 182 }),
      rule("cgia-followup", { anchorRuleId: "cgia", offsetDays: 14 }),
      rule("unrelated", { anchor: "matter_opened", offsetDays: 7 }),
    ];
    const ds = [
      dl("d-cgia", "cgia", "2026-09-08"),
      dl("d-follow", "cgia-followup", "2026-09-22"),
      dl("d-unrelated", "unrelated", "2026-10-23"),
    ];
    const cs = planRecalc(ds, rs, { kind: "incident", newIncidentKey: "2026-03-20" });
    expect(moves(cs)).toEqual(["d-cgia:2026-09-08→2026-09-18", "d-follow:2026-09-22→2026-10-02"]);
    expect(cs[0].anchorText).toBe("Incident date");
  });
});
