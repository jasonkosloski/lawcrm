/** The Billing tab's Settlement waterfall card. */

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { SettlementApprovals } from "@/components/matters/settlement/settlement-approvals";
import { SettlementComposer } from "@/components/matters/settlement/settlement-composer";
import { SettlementLienForm } from "@/components/matters/settlement/settlement-lien-form";
import { SettlementLienList } from "@/components/matters/settlement/settlement-lien-list";
import { type MatterSettlement } from "@/lib/queries/settlements";
import { formatMoney } from "@/lib/format-money";

export function SettlementCard({
  matterId,
  settlement,
  canEdit,
  canManageLiens,
  canApprove,
}: {
  matterId: string;
  settlement: MatterSettlement | null;
  canEdit: boolean;
  canManageLiens: boolean;
  canApprove: boolean;
}) {
  const settlementLocked = settlement?.status === "disbursed" || settlement?.status === "closed";
  // Liens move the client net, so they lock with the sign-offs
  // (approved) and the money (disbursed/closed). The server enforces
  // the same rule.
  const liensLocked =
    settlement?.status === "approved" ||
    settlement?.status === "disbursed" ||
    settlement?.status === "closed";
  return (
    <Card className="p-0 overflow-hidden">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          Settlement
          {settlement && (
            <span
              className={cn(
                "text-2xs font-medium px-2 py-0.5 rounded-full border",
                settlement.status === "disbursed" || settlement.status === "closed"
                  ? "bg-ok-soft text-ok border-line"
                  : settlement.status === "approved"
                    ? "bg-brand-soft text-brand-700 border-brand-200"
                    : "bg-paper-2 text-ink-3 border-line",
              )}
            >
              {settlement.status}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex flex-col gap-3">
        {!settlement ? (
          <>
            <div className="text-2xs text-ink-4 leading-relaxed">
              No settlement opened on this matter yet. Contingency matters use this section to
              capture the gross settlement, firm fee, advanced costs, and any liens — the
              client&apos;s net distribution computes automatically.
            </div>
            <SettlementComposer
              matterId={matterId}
              initial={null}
              canEdit={canEdit}
              canApprove={canApprove}
            />
          </>
        ) : (
          <>
            {/* Waterfall: gross → firm fee → advanced costs →
                liens → client net. Each row is a flow stage so the
                lawyer can scan it the way they'd narrate it to a
                client. */}
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-xs">
              <dt className="text-ink-2 font-medium">Gross settlement</dt>
              <dd className="font-mono text-ink">{formatMoney(settlement.grossAmount)}</dd>

              <dt className="text-ink-3 pl-3">
                Firm fee
                {settlement.firmFeePercent !== null && (
                  <span className="text-ink-4 ml-1">({settlement.firmFeePercent}%)</span>
                )}
              </dt>
              <dd className="font-mono text-warn">−{formatMoney(settlement.firmFee)}</dd>

              {settlement.advancedCosts > 0 && (
                <>
                  <dt className="text-ink-3 pl-3">Advanced costs</dt>
                  <dd className="font-mono text-warn">−{formatMoney(settlement.advancedCosts)}</dd>
                </>
              )}

              {settlement.lienTotal > 0 && (
                <>
                  <dt className="text-ink-3 pl-3">
                    Liens
                    <span className="text-ink-4 ml-1">({settlement.liens.length})</span>
                  </dt>
                  <dd className="font-mono text-warn">−{formatMoney(settlement.lienTotal)}</dd>
                </>
              )}

              <dt className="text-ink font-semibold pt-1.5 border-t border-line mt-1">
                Client net
              </dt>
              <dd
                className={cn(
                  "font-mono font-semibold pt-1.5 border-t border-line mt-1",
                  settlement.clientNet < 0 ? "text-warn" : "text-ok",
                )}
              >
                {settlement.clientNet < 0
                  ? `−${formatMoney(-settlement.clientNet)}`
                  : formatMoney(settlement.clientNet)}
              </dd>
            </dl>

            {/* The net is signed, never clamped: deductions larger
                than the gross are a shortfall the firm would be
                paying out of pocket, not a clean $0.00. */}
            {settlement.clientNet < 0 && (
              <div
                role="alert"
                className="px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn"
              >
                Shortfall: the fee, costs and liens exceed the settlement by{" "}
                {formatMoney(-settlement.clientNet)}. Resolve before disbursing.
              </div>
            )}

            {/* Liens list (read-only chips by default; the form
                below adds new ones when the user has the
                permission). */}
            <SettlementLienList
              liens={settlement.liens}
              canManage={canManageLiens}
              locked={liensLocked}
            />

            {canManageLiens && !liensLocked && <SettlementLienForm settlementId={settlement.id} />}

            {/* Approval steps. Always rendered when present (read
                view for everyone with view perm); the buttons only
                show for users holding matters.settlement.approve. */}
            {settlement.approvals.length > 0 && (
              <SettlementApprovals
                approvals={settlement.approvals.map((a) => ({
                  id: a.id,
                  step: a.step,
                  label: a.label,
                  status: a.status,
                  approverName: a.approverName,
                  approvedAt: a.approvedAt,
                  notes: a.notes,
                }))}
                canApprove={canApprove}
                settlementLocked={settlementLocked}
              />
            )}

            {canEdit && (
              <SettlementComposer
                matterId={matterId}
                initial={{
                  grossAmount: settlement.grossAmount,
                  firmFeePercent: settlement.firmFeePercent,
                  firmFee: settlement.firmFee,
                  advancedCosts: settlement.advancedCosts,
                  status: settlement.status,
                }}
                canEdit={canEdit}
                canApprove={canApprove}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
