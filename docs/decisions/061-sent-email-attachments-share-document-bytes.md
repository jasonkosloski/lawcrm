# ADR-061: Sent email attachments share their document's stored bytes

**Date:** 2026-10-21
**Status:** Accepted.

**Context:** Compose and reply attach documents filed to the email's matter or lead (the action takes document ids; ADR-034). The sent message needs `EmailAttachment` rows so the thread reader shows and serves the files. Until now no storage key was shared between a Document and an EmailAttachment: filing an inbound attachment copies its bytes (ADR-043), and `deleteDocument` unlinked a key as soon as no other Document pointed at it.

**Decision:**

- A sent message's attachment row stores its Document's `fileUrl`; no copy is made.
- `isStoredFileReferenced` (`src/lib/stored-file-refs.ts`) counts Document rows AND EmailAttachment rows, and every byte deletion that can touch a document key (`deleteDocument`, draft cleanup, upload rollback) checks it first.
- If the document's bytes vanished while Gmail took the upload, the attachment row is written with `fileUrl` null rather than pointing at nothing.

**Trade-offs:**

- (+) No duplicate storage for every file a lawyer sends; sending stays one read of the bytes
- (+) The sent copy keeps working after the document is deleted from the matter, which matches what the recipient has
- (-) Deleting a document no longer always frees its bytes; they live as long as a sent email references them
- (-) Any new byte-deletion path must use `isStoredFileReferenced`, not a Document-only count
