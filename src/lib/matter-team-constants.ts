/**
 * Matter team role constants — shared between server actions, the
 * edit form's role picker, and the overview's roster display so a
 * label or new role lands in one place and propagates everywhere.
 *
 * `lead` is special: at most one active lead per matter. The
 * updateMatter action reassigns it; the team-management UI uses
 * the same lead-handling code rather than a separate field.
 */

export const MATTER_TEAM_ROLES = [
  "lead",
  "co_counsel",
  "paralegal",
  "investigator",
  "of_counsel",
] as const;

export type MatterTeamRole = (typeof MATTER_TEAM_ROLES)[number];

export const MATTER_TEAM_ROLE_LABEL: Record<MatterTeamRole, string> = {
  lead: "Lead attorney",
  co_counsel: "Co-counsel",
  paralegal: "Paralegal",
  investigator: "Investigator",
  of_counsel: "Of counsel",
};

/** Same labels but already keyed for an arbitrary string, so callers
 *  reading legacy rows don't crash on an unexpected role string. */
export function matterTeamRoleLabel(role: string): string {
  return (
    (MATTER_TEAM_ROLE_LABEL as Record<string, string>)[role] ?? role
  );
}
