/**
 * Settlement Approval Steps
 *
 * Renders the 4-step approval chain seeded onto a settlement at
 * create time. Each step has a label, status (pending / approved
 * / rejected), an approver attribution when approved, and an
 * optional notes line.
 *
 * Authorized users (matters.settlement.approve) see two buttons
 * per pending step: Approve / Reject. Approved steps display the
 * approver name + timestamp. Reject is recoverable — clicking
 * Approve on a rejected step flips it to approved.
 *
 * The settlement auto-promotes its own status to "approved"
 * server-side when every step is approved; the disbursement
 * itself stays an explicit follow-up action.
 */

"use client";

import { useState, useTransition } from "react";
import {
  Check,
  CheckCircle2,
  Circle,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { setApprovalStepStatus } from "@/app/actions/settlements";

type ApprovalRow = {
  id: string;
  step: number;
  label: string;
  status: string;
  approverName: string | null;
  approvedAt: Date | null;
  notes: string | null;
};

const formatDate = (d: Date | null): string => {
  if (!d) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export function SettlementApprovals({
  approvals,
  canApprove,
  settlementLocked,
}: {
  approvals: ApprovalRow[];
  canApprove: boolean;
  /** True when the settlement is "disbursed" or "closed" — every
   *  step is read-only at that point. */
  settlementLocked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notesByApproval, setNotesByApproval] = useState<
    Record<string, string>
  >({});

  if (approvals.length === 0) return null;

  const handle = (
    approvalId: string,
    status: "approved" | "rejected" | "pending"
  ) => {
    setError(null);
    const note = notesByApproval[approvalId];
    startTransition(async () => {
      const res = await setApprovalStepStatus(approvalId, status, note);
      if (!res.ok) {
        setError(res.error ?? "Couldn't update approval step.");
      } else {
        setNotesByApproval((prev) => {
          const next = { ...prev };
          delete next[approvalId];
          return next;
        });
      }
    });
  };

  const approvedCount = approvals.filter((a) => a.status === "approved").length;
  const rejectedCount = approvals.filter((a) => a.status === "rejected").length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Approval chain
        </div>
        <div className="text-2xs text-ink-4 font-mono">
          {approvedCount}/{approvals.length} approved
          {rejectedCount > 0 && ` · ${rejectedCount} rejected`}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <ul className="border border-line rounded-md overflow-hidden divide-y divide-line">
        {approvals.map((a) => {
          const isApproved = a.status === "approved";
          const isRejected = a.status === "rejected";
          const Icon = isApproved
            ? CheckCircle2
            : isRejected
              ? X
              : Circle;
          const iconClass = isApproved
            ? "text-ok"
            : isRejected
              ? "text-warn"
              : "text-ink-4";
          return (
            <li key={a.id} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex items-start gap-3">
                <Icon size={14} className={cn("shrink-0 mt-0.5", iconClass)} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink leading-snug">
                    <span className="font-mono text-ink-4 mr-1.5">
                      {a.step}.
                    </span>
                    {a.label}
                  </div>
                  {isApproved && a.approverName && (
                    <div className="text-2xs text-ink-4 mt-0.5">
                      Approved by {a.approverName}
                      {a.approvedAt && ` · ${formatDate(a.approvedAt)}`}
                    </div>
                  )}
                  {isRejected && (
                    <div className="text-2xs text-warn mt-0.5">Rejected</div>
                  )}
                  {a.notes && (
                    <div className="text-2xs text-ink-3 mt-0.5 italic">
                      {a.notes}
                    </div>
                  )}
                </div>
              </div>

              {canApprove && !settlementLocked && (
                <div className="flex items-center gap-2 pl-7">
                  {!isApproved && (
                    <>
                      <input
                        type="text"
                        value={notesByApproval[a.id] ?? ""}
                        onChange={(e) =>
                          setNotesByApproval((prev) => ({
                            ...prev,
                            [a.id]: e.target.value,
                          }))
                        }
                        placeholder="Optional note"
                        maxLength={400}
                        className="flex-1 h-7 px-2 rounded-md border border-line bg-white text-2xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
                      />
                      <Button
                        type="button"
                        onClick={() => handle(a.id, "approved")}
                        disabled={pending}
                        className="h-7 px-2 text-2xs"
                      >
                        <Check size={11} />
                        Approve
                      </Button>
                    </>
                  )}
                  {!isRejected && !isApproved && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handle(a.id, "rejected")}
                      disabled={pending}
                      className="h-7 px-2 text-2xs"
                    >
                      Reject
                    </Button>
                  )}
                  {(isApproved || isRejected) && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handle(a.id, "pending")}
                      disabled={pending}
                      className="h-7 px-2 text-2xs text-ink-4"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
