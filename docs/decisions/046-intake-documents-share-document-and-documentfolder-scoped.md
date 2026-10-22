# ADR-046: Intake documents share Document and DocumentFolder, scoped to a lead until conversion

**Date:** 2026-10-18
**Status:** Accepted

**Context:** After intake notes (ADR-044) and tasks/events (ADR-045), intake needed documents (retainers, ID scans, generated letters) before a matter exists, carried onto the matter when the lead converts.

**Decision:**

- **Same tables, exactly-one scope.** `Document.leadId` and `DocumentFolder.leadId` were added and `matterId` made nullable on both. Exactly one of (matterId, leadId) is set on each row, and a folder and its documents share a scope. `RecordScope` helpers in `src/lib/record-scope.ts` (`scopeOf`, `scopeWhere`, `scopeBasePath`) and `src/lib/scope-access.ts` (`assertScopeAccess`, `assertScopeWritable`, `revalidateDocumentScope`) are the single place scope is resolved.
- **Upload routes accept `leadId`.** The streaming and blob upload routes take `leadId` in place of `matterId`; the viewer, listing and download resolve the row's scope rather than assuming a matter.
- **No matter wall on lead documents.** A lead has no team, so any signed-in user can view and download lead documents (same as the intake pages); the `documents.*` write keys gate upload, organize and delete. Matter documents keep the matter wall.
- **Converted leads are read-only.** Writes to a converted lead's documents and folders are refused; the tab links to the matter.
- **Conversion re-homes, not copies.** `rehomeLeadDocuments` (`src/lib/lead-documents.ts`) moves folders and documents onto the matter inside the convert transaction. A root folder whose name collides with an existing matter root folder gets a "(n)" suffix.
- **Uploads survive a mid-upload conversion.** Both upload paths decide scope and insert in one transaction that takes `FOR SHARE` on the lead row (`resolveLeadUploadTarget`); a lead converted meanwhile reroutes the file onto its matter (folder falls back to the matter root). If the uploader can't access that matter the upload is discarded (fail closed).
- **Search lists intake documents** labelled "Intake · {lead}", linking to the intake viewer.

**Trade-offs:**

- (+) One document system; the viewer, flags, email extraction and copies work unchanged
- (+) Conversion moves rows; no files are copied
- (-) Every reader of `Document.matterId` has to handle null
- (-) Copy and move across scopes are refused; there is no lead-to-matter copy
- (-) A streaming upload to a lead that converts mid-request can land on the lead (known, minor)
