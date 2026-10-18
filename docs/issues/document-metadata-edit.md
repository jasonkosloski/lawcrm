# No document metadata edit (rename, re-categorize) and a capped receipt picker

## Problem
After upload a document's display name and category cannot be changed: there is no edit-metadata action. It needs a new `documents.edit` permission key (ADR-034 notes this). Separately, the expense receipt picker on the Time and Expenses tab lists at most 200 documents (`RECEIPT_PICKER_LIMIT` in `src/app/(dashboard)/matters/[id]/time/page.tsx`).

## Why it matters
Typos and wrong categories are permanent; a matter with over 200 documents cannot attach a receipt to a document beyond the cap.

## Options or fix
- Add `documents.edit` (view/add/edit/delete split per PERMISSIONS.md), an `updateDocumentMetadata` action with activity log, and a rename/category dialog in the Documents tab and viewer header. Grant to roles that hold `documents.upload`.
- Replace the receipt picker's fixed list with a search-as-you-type picker.

## Related
[documents.md](../features/documents.md), [ADR-034](../decisions/034-document-bytes-never-travel-through-server-actions.md)
