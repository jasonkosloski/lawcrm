/**
 * Shared form-state shapes for the lead intake actions.
 */

export type ConvertLeadFormState = {
  status: "idle" | "ok" | "error";
  errors?: Partial<
    Record<
      | "practiceAreaId"
      | "stageId"
      | "name"
      | "feeStructure"
      | "_form",
      string[]
    >
  >;
};

export const convertLeadInitialState: ConvertLeadFormState = { status: "idle" };

export type DeclineLeadFormState = {
  status: "idle" | "ok" | "error";
  errors?: Partial<Record<"reason" | "_form", string[]>>;
};

export const declineLeadInitialState: DeclineLeadFormState = { status: "idle" };
