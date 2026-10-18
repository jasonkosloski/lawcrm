# ADR-048: Generated folders carry their source and are protected

**Date:** 2026-10-18
**Status:** Accepted

**Context:** Records-request folders (`Investigation/Records Requests/...`) were found by name and could be renamed, moved or deleted like any folder, which orphaned a request's documents or made the app create a duplicate tree. Users also could not tell which folders the app owned.

**Decision:**
- `DocumentFolder.systemKind` (`records_root`, `records_request`, `records_request_docs`, `records_responsive_docs`) marks a generated folder; `recordsRequestId` (FK to `RecordsRequest`, SetNull) links it to its request. Folders are found by that link, not by name. Kinds and helpers live in `src/lib/records-requests/folder-kinds.ts`.
- A non-null `systemKind` means protected: the server refuses rename, move and delete (`src/app/actions/document-folders.ts`). An ancestor of a protected folder cannot be deleted either, since delete re-parents children. Deleting a request clears the link and unprotects its folders.
- Resolution finds a stamped `records_root` scope-wide first, so renaming or moving Investigation (an ordinary folder) never spawns a second tree. `renameFolder` writes conditionally (`systemKind: null`), so a folder stamped between read and write is still refused.
- The UI mirrors this: `FolderRowActions` hides the refused items (`isProtected`, `hasProtectedDescendant`), and `FolderSourceBadge` links the folder to its request. The server stays the authority; the UI is a convenience.

**Trade-offs:**
- (+) No duplicate or orphaned request trees; a folder explains why it cannot be edited
- (-) Users cannot reorganize generated folders until the request is deleted

**Known limits and deliberate behavior:**
- Once a scope has had a request, Records Requests (and therefore Investigation, as its ancestor) stay protected even when empty. Unprotecting needs the requests deleted, or a future admin override.
- The tree rail and the viewer file tree show a protected icon only (with an accessible label), no link: a link cannot nest inside the row link. The Documents list rows show the linked badge.
- An unstamped folder named "Records Requests" directly under Investigation is adopted (stamped) by name. This is deliberate.
