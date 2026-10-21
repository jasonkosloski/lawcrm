# Expense receipt picker is capped at 200 documents

## Problem
The expense receipt picker on the Time and Expenses tab lists at most 200 documents (`RECEIPT_PICKER_LIMIT` in `src/app/(dashboard)/matters/[id]/time/page.tsx`).

## Why it matters
A matter with over 200 documents cannot attach a receipt to a document beyond the cap.

## Options or fix
- Replace the fixed list with a search-as-you-type picker.

## Related
[documents.md](../features/documents.md)
