# ADR-043: Email attachments become documents; "Copy to…" makes independent copies without re-uploading

**Date:** 2026-10-18 (revised the same day: links → copies)
**Status:** Accepted

**Context:** Emails uploaded as evidence (.eml/.msg) carry the files that matter — reports, photos, spreadsheets — but those were only names on a chip. To review or flag one, someone had to download the email, extract it by hand and upload it again; and putting a document in a second folder meant uploading it twice.

**Decision:**

- **Extract on upload.** After an email document is created (both upload transports), each listed attachment becomes its own Document (`src/lib/email-attachment-extract.ts`): stored under its own key, `parentDocumentId` = the email, `attachmentIndex` = its position (so the viewer's chips open it), the email's folder and category, `source: "email_attachment"`. Images embedded in the body (cid:) aren't attachments. Extraction is idempotent (atomic claim on `attachmentsExtractedAt`), rolls back fully on failure, and is best-effort — the upload itself never fails because of it. Older emails get an "Add attachments to documents" button (`documents.upload`).
- **Attachments live under their email.** They share its folder and move with it; moving one directly is refused. Trees and the Documents tab show them nested under the email.
- **"Copy to…" makes a real copy, not a link** (`copyDocumentToFolder`, `documents.organize`). The copy is its own document from then on — name, folder, status, flags and notes are separate — but it shares the stored file, so nothing is uploaded or stored again. `deleteDocument` already removes bytes only when no other row references them, so deleting either side is safe. Copying an email copies its attachments too. (The first version shipped "Also file in" links to one shared document; the user wanted copies to behave as their own documents, so the links table was dropped and existing links converted to copies.)
- **Deleting an email** (the user's rule): an attachment that's been copied elsewhere is "saved" and lives on as that copy; attachments with no copy are named in the delete prompt with an explicit choice — delete with the email (default) or keep in the folder. The server refuses to guess.

**Trade-offs:**

- (+) No re-uploads: every attachment is reviewable and flaggable where it arrived, and copies cost no storage
- (+) Copies behave exactly like any other document
- (-) A copy doesn't track its original — later edits, flags or notes on one don't appear on the other (by design)
- (-) Attachment bytes are stored twice (inside the email and as their own file); emails over 25 MB and attachments past 100 per email aren't extracted
- (-) Outlook .msg embedded (cid) images still show as blocked in the body; nested emails inside emails are extracted as files, not expanded
