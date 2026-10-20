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
      | "originatingDocumentId"
      | "agreementStatus"
      | "agreementSignedDate"
      | "_form",
      string[]
    >
  >;
  /** Set when the live conflict check came back "warn" and the form
   *  did not acknowledge it: the dialog shows a review tick for this
   *  many possible conflicts and the user resubmits. */
  conflictWarnings?: number;
};

export const convertLeadInitialState: ConvertLeadFormState = { status: "idle" };

export type DeclineLeadFormState = {
  status: "idle" | "ok" | "error";
  errors?: Partial<Record<"reason" | "_form", string[]>>;
};

export const declineLeadInitialState: DeclineLeadFormState = { status: "idle" };
