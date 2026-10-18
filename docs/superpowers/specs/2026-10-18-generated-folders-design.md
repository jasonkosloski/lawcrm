# Generated folders: marked, linked, protected — design

**Date:** 2026-10-18
**Status:** Draft for review
**Tier:** Full (schema change + migration with backfill)

## Goal

Folders the system creates for records requests are visibly marked, link back to what generated them, and can't be broken by hand.

### What the user decided

- A marker and link on the **Records Requests** folder and on each **request folder** (plus its two subfolders, **Request documents** and **Responsive documents**).
- **Investigation** gets no marker.
- **Protected** means no delete, rename or move. Files inside stay fully editable: add, move out, rename, delete.
- No folder can be deleted while it contains a protected folder anywhere below it. That covers Investigation and anything above a protected folder.
- Approach: record the source on the folder itself (option B), not inferred from its contents.

## Schema

`DocumentFolder` gains:

| Field | Type | Notes |
|---|---|---|
| `systemKind` | String? | null = an ordinary user folder. Otherwise one of `records_root` (Records Requests), `records_request` (a request's folder), `records_request_docs` (Request documents), `records_responsive_docs` (Responsive documents). A non-null value means protected. |
| `recordsRequestId` | String? | FK → RecordsRequest, `onDelete: SetNull`. Set on `records_request` and its two subfolders. |

Index on `recordsRequestId`. Kinds are listed once in `src/lib/records-requests/folder-kinds.ts`, which holds the labels and the link target for each kind.

**Migration backfill** (SQL, in the same migration), for folders created before this change:

1. A folder named `Records Requests` directly under a root `Investigation` (case-insensitive), in the same scope → `records_root`.
2. Its child folders → `records_request`. `recordsRequestId` = the request that owns the most documents tagged inside it or its subfolders (today's ownership rule). Children with no tagged documents are left unmarked.
3. A marked request folder's children named `Request documents` / `Responsive documents` → the matching kind, with the same `recordsRequestId`.

Production data here is tiny (the feature shipped today). The backfill is written to be safe on an empty database and to run idempotently.

## Behaviour

- **Creation:** `resolveRecordsFolder` / `resolveRecordsRoleFolder` set `systemKind` (and `recordsRequestId`) when they create a folder. Finding "my folder" becomes a lookup by `recordsRequestId` instead of name-plus-contents inference. That retires the fragile inference, including the "renamed folder makes a new one" and "freed folder gets adopted" edge cases. The Investigation folder is still found or created by name, with no kind.
- **Legacy root "Records" adoption** (from the previous change): when moved and renamed, it also gets `systemKind = records_root`.
- **Request deleted:** its folders lose the request link (SetNull). `deleteRecordsRequest` also clears `systemKind` on those folders in the same transaction, so they become ordinary folders the user can tidy away. The files stay.
- **Conversion:** folders re-home with their fields intact (existing `rehomeLeadDocuments`).

## Enforcement (server)

All in `src/app/actions/document-folders.ts`:

- `renameFolder`, `moveFolder` on a protected folder → `{ ok: false, error: "This folder is managed by its records request and can't be renamed, moved or deleted." }`
- `deleteFolder` on a protected folder → the same message.
- `deleteFolder` on a folder with a protected descendant → "This folder contains folders managed by records requests, so it can't be deleted."
- Moving an ordinary folder **into** a protected folder is allowed (the protected folder itself doesn't move).

There are no new permission keys. Existing `documents.folder.*` / `documents.organize` gates still apply first. Protection is enforced on the server, so a crafted call can't get round it.

## UI

The folder tree, the folder list in the Documents browser, and the document viewer's file tree:

- **Records request folders** (and their two subfolders): a small badge (clipboard icon + "Records request"). It links to `/…/records/{requestId}`, and its tooltip shows the request subject.
- **Records Requests folder:** a badge "Records requests" linking to `/…/records`.
- **Protected folders:** Rename, Move and Delete are hidden from the row menu.
- **Ancestors of protected folders:** Delete is hidden.

The page loader already has the folder rows. The query adds `systemKind`, `recordsRequestId` and the request subject, and computes "has a protected descendant" from the folder list it already loads.

## Testing

- **Migration:** `check:migrations` passes. A backfill test seeds the pre-change shape (Investigation / Records Requests / request folder with tagged docs, plus both subfolders) and asserts the kinds and links after running the backfill SQL. The SQL lives in a function, or the test runs the migration file's statements.
- **Folder resolution:** created folders carry their kind and link. Resolution is by link, so a renamed-by-hand legacy folder is still found. A deleted request clears protection.
- **Enforcement:** rename, move and delete are refused on each protected kind. Deleting Investigation or any ancestor is refused. Moving an ordinary folder into a protected one is allowed. Ordinary folders are unchanged.
- **UI:** the badge and link render for each kind, menu items are hidden, and an ancestor's Delete is hidden.

## Docs

Changelog entry in SCHEMA_NOTES, an ADR (generated folders carry their source; protection rules), a feature-doc line, and a UI_PATTERNS note on the "generated" badge.

## Out of scope

Making other features' folders generated (for example email-attachment extraction), and admin override to unprotect.

## Notes from final review

- Known limit: once a scope has had a request, Records Requests (and Investigation above it) stay protected even when empty.
- Tree rail and viewer file tree show a protected icon only (a link cannot nest in the row link); Documents list rows show the linked badge.
- An unstamped "Records Requests" folder under Investigation is adopted (stamped) by name, deliberately.
- Resolution looks up a stamped `records_root` scope-wide before Investigation, so renaming or moving Investigation creates no second tree.
