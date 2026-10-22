# ADR-052: Portal uploads are ordinary matter documents

**Date:** 2026-10-19
**Status:** Accepted

**Context:** Clients need to download documents the firm chooses to share and to send documents back. The portal must never expose a matter's files by default, and untrusted client bytes must not become a new storage silo that staff, search and retention have to special-case.

**Decision:**

- **Client uploads are ordinary `Document` rows** on the matter, in the protected "From client" folder, tagged with `portalUploaderId`, `portalBatchId`, optional `documentRequestId` and `clientNote`. Staff, search, retention and moves all work on them unchanged. An identity with uploads is disabled, never deleted (`Restrict`).
- **Three-state file share** (`clientShare`: null / `shared` / `hidden`) plus folder `clientShared` inherited by the subtree. `hidden` beats a shared folder, `shared` beats an unshared one, null follows the folder. One module (`document-visibility*.ts`) is the only definition of "visible to the client".
- **Matter-wide audience:** every live portal holder on the matter sees the same shared set. No per-client sharing in v1.
- **No scanner in v1.** Defense is an extension allowlist (last extension only, content type derived from it), size caps, a daily cap, and attachment-only downloads that return 404 for anything not visible. Uploads are never rendered on our origin.
- **Upload identity comes only from the signed token payload** and completion re-checks access (revocation can happen mid-upload); a per-matter advisory lock serializes folder creation, batch ordering and request linking, so no unique constraint was added.

**Trade-offs:**

- (+) One document model; no second store or retention path
- (+) A single visibility function is easy to test and hard to bypass
- (-) A client upload stays downloadable by co-clients of the matter even if staff move or unshare it
- (-) No virus scanning until a scanner is added
- (-) Matter-wide audience means sharing is all-or-nothing across a matter's clients
