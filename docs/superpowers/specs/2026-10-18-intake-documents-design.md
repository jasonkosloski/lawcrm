# Intake documents — design

**Date:** 2026-10-18
**Status:** Draft for review
**Part of:** records requests (see `2026-10-18-records-requests-design.md`). This piece ships first.

## Goal

Documents and folders can belong to an intake lead before a matter exists, and move to the matter when the lead converts. This is the same scope pattern as intake notes, tasks and events (ADR-044, ADR-045). It's needed so a records request on a lead can hold its generated letter and the records that come back. It's also useful on its own, for example a prospective client's photos or a police report pulled during evaluation.

## Schema

- `Document.leadId String?` (FK → Lead, Cascade) and `DocumentFolder.leadId String?` (FK → Lead, Cascade), each indexed.
- `Document.matterId` and `DocumentFolder.matterId` become nullable.
- Invariant (app-enforced): **exactly one** of (matterId, leadId) on both models. The check helper extends `src/lib/record-scope.ts` (`scopeOf`, which throws on both or neither).
- A folder and the documents in it share a scope. Move and copy refuse a target in a different scope.
- Migration: add columns + indexes + FKs, drop NOT NULL. No backfill: every existing row has a matterId.

## Conversion

Inside `convertLeadToMatter`'s transaction, after the matter is created and its automation defaults are applied:

1. Re-home the lead's folders: `matterId = newMatter`, `leadId = null`. A root-level lead folder whose name collides with a root folder already on the new matter gets the existing collision suffix (`src/lib/folder-tree.ts`, " (2)"). Nested folders keep their parents.
2. Re-home the lead's documents the same way. Their `folderId`s are unchanged, because the folders moved with them.
3. Activity-log "N intake documents carried forward" on the matter.

## Upload, download, viewer

- `POST /api/documents/upload` and the Vercel Blob client-upload path accept `leadId` as an alternative to `matterId` (exactly one is required; it's validated before any file part is read, same as today). If a folderId is sent, the folder must be in the same scope.
- `/api/documents/[id]/download` gates lead documents with `documents.*` like matter documents. There's no matter wall, since a lead has no team (same as lead notes).
- Viewer route: `/intake/[id]/documents/[documentId]` reuses the matter viewer's components (PDF, media, email, Excel, images, flags).
- `extractAttachments`, "Copy to…", flags and delete reference-counting work unchanged. They key off the document, and the copy target folder must be in the same scope.

## UI

- An intake **Documents** tab (`/intake/[id]/documents`), between Events and Communication. It reuses the matter Documents tab: folder tree, multi-file uploader, single-file composer, Move/Copy, delete, download, Generate from template.
- The documents components take a `RecordScope` instead of `matterId` (the notes/tasks/events pattern). On a lead, matter-only links are hidden; today that's the evidence links on flags, if any.
- A converted lead's tab shows the usual banner linking to the matter's documents.

## Templates

`resolveMergeContext` accepts a lead: `client.*` comes from the lead's contact, `matter.*` fields resolve to null, so they render as the engine's visible "[… — not on file]" placeholder and are reported missing, and `firm.*`, `user.*` and `today` are unchanged. `generateDocumentFromTemplate` accepts a `RecordScope`.

## Null-safety sweep

Every reader of `Document.matterId` and `DocumentFolder.matterId` handles null (about 57 reads across about 15 files). That covers search (lead documents labelled "Intake · {lead}" and linked to the intake tab), `CHILD_RESOLVERS` in `matter-access.ts` (`document`/`documentFolder` already tolerate a null matter), the email-attachment and copy code paths, flagged-moment queries, and revalidation (a `scopePaths(scope, "documents")` helper). Typecheck errors drive the sweep, and each site gets a scope-correct fix, not a non-null assertion.

## Permissions

The existing `documents.*` keys. No new keys.

## Testing

- Integration: upload to a lead (route), the scope-mismatch folder refusal, move/copy across scopes refused, download gate, conversion re-home with a folder-name collision, delete reference-counting across a lead copy.
- Unit: the scope helper (both/neither throws), the collision-suffix path on conversion.
- Page: the intake Documents tab composer gating and the converted-lead banner.
- `matter-access-guards.test.ts`: allowlist entries only where an action genuinely has no matter.

## Docs

SCHEMA_NOTES (models table + changelog), ADR-046, FEATURES, UI_PATTERNS (RecordScope paragraph now includes documents).

## Out of scope

Lead-scoped expenses; Evidence-model changes; a firm-wide documents view.
