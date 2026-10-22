# ADR-034: Document bytes never travel through server actions

**Date:** 2026-10-17
**Status:** Accepted

**Context:** Server Actions cap the request body (about 1 MB) and run on a serverless function; the single-file composer originally posted its file through `uploadDocument` and silently failed for ordinary files. ADR-015 already moved bulk uploads off the serverless path.

**Decision:** Any code path that carries file bytes uses an upload transport, never a server action: the streaming busboy route `POST /api/documents/upload` under the local driver, or the client-direct Blob upload (`/api/documents/upload/blob`) under the Vercel Blob driver. The uploader and the single-file composer pick the transport from the `storageDriver` prop supplied by the server component. The route accepts optional `name` (single-file only) and `category` fields; the blob `clientPayload` accepts `category`. The `uploadDocument` server action is no longer referenced by the UI (it still enforces `documents.upload` for programmatic callers; removal is a dead-code decision). The composer uses a manual submit handler, so the typed form survives errors. Rename / re-categorize is the metadata-only `updateDocumentMetadata` action under `documents.edit`; it never carries bytes.

**Trade-offs:**

- (+) Large files work in production; the 1 MB action cap can't truncate an upload
- (-) Two transports to keep behaviorally identical (name/category round-trip, permission checks, audit rows)
