# Reads and exports with only a session guard

## Problem
Several read paths require a signed-in user but no permission key: `exportContactsCsv` (`src/app/actions/contacts.ts`, `getCurrentUserId` only; the export IS recorded in the activity log), the command-palette data, `searchAttendeesAction` (`attendee-search.ts`), and `previewDocumentFromTemplate` (scope access is checked via `assertScopeAccess`, and records-request merge data needs `records.view`, but no template/document key gates the preview). ADR-038 closed the billing read surface with `billing.view`, so that item from the old open list is resolved.

## Why it matters
Any signed-in user, regardless of role, can export the full contact list or enumerate people through the attendee search. For a law firm, bulk contact export is the most sensitive of these.

## Options or fix
- Mint view/export keys (e.g. `contacts.export`) in `src/lib/permissions.ts`, grant them by migration to roles that hold related keys (the ADR-038 pattern), gate with `requirePermission`.
- Decide whether the palette and attendee search should inherit `contacts.view` and matter-team access (ADR-039) rather than a new key.

## Related
[ADR-028](../decisions/028-layouts-are-not-auth-gates-every-page.md), [ADR-038](../decisions/038-billing-view-gates-the-billing-read-surface.md), [PERMISSIONS.md](../PERMISSIONS.md)
