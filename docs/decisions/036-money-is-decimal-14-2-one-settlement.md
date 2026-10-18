# ADR-036: Money is DECIMAL(14,2); one settlement per matter; hot-path indexes

**Date:** 2026-10-17
**Status:** Accepted (completes ADR-024)

**Context:** ADR-024 rounds every persisted amount in code (`roundMoney`), but the columns were unconstrained `Decimal(65,30)`, so a path that skipped the helper could still store sub-cent values. The one-settlement-per-matter rule rested on an advisory lock (ADR-030). The perf audit listed missing indexes.

**Decision:**
- Every money column (`Matter.trustBalance/wipAmount`, `TimeEntry.rate/amount`, `Expense.amount`, `Invoice.subtotal/taxAmount/totalAmount/paidAmount`, `InvoicePayment.amount`, `TrustTransaction.amount`, `Settlement.grossAmount/firmFee/advancedCosts/clientNet`, `SettlementLien.originalAmount/negotiatedAmount`) is `DECIMAL(14,2)` (up to 999,999,999,999.99). `Settlement.firmFeePercent` is `DECIMAL(7,4)`. `ALTER ... TYPE` rounds existing values to the new scale in place (half away from zero); the code-side `roundMoney` stays as the first line of defence and for intermediate math.
- Not changed: `TimeEntry.hours` is `Float` (hours are validated to 2 dp on input and are not money; amounts are derived and rounded). Converting it to Decimal needs a wide code change for no correctness gain today.
- `Settlement.matterId` is unique. The migration starts with a guard that **raises an exception naming the offending matters** if any matter has 2+ settlements, so a deploy fails before changing anything and nothing is ever deleted. The per-matter advisory lock stays (it serializes status transitions and amount edits); reads and the upsert use the unique key.
- New indexes: `TimeEntry(invoiceId)`, `EmailAttachment(messageId)`, `MatterContact(contactId)`, `SettlementLien(settlementId)`, `SettlementApproval(settlementId)`, `Deadline(status, dueDate)`, `ActivityLog(matterId, timestamp)` and `(userId, type, timestamp)`, `MatterTeamMember(userId, removedAt)`. The old `settlements(matterId)` index is dropped as redundant with the unique one.

**Trade-offs:**
- (+) The database refuses sub-cent or oversized amounts and a second settlement
- (-) The rounding step is irreversible; deploy notes tell the operator to expect it
- (-) Extra indexes add small write cost on hot tables
