# Template preview has only a session guard

## Problem
`previewDocumentFromTemplate` checks scope access via `assertScopeAccess` (and records-request merge data needs `records.view`), but no template/document key gates the preview itself.

Resolved or decided:
- Contacts CSV export is gated on `contacts.export` (granted by migration to roles holding `contacts.edit`).
- Command-palette data and attendee search stay session-only by decision: the contact directory is firm-wide, and matter results in the palette already honour matter access (ADR-039).

## Options or fix
- Gate the preview on the same key that gates generating from a template, so preview never shows more than a user could produce.

## Related
[ADR-028](../decisions/028-layouts-are-not-auth-gates-every-page.md), [ADR-038](../decisions/038-billing-view-gates-the-billing-read-surface.md), [PERMISSIONS.md](../PERMISSIONS.md)
