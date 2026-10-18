# ADR-011: OAuth tokens encrypt at rest via a Prisma query extension

**Date:** 2026-06-10
**Status:** Accepted

**Context:** Gmail OAuth (the remaining P0) will store live `accessToken` / `refreshToken` values on `EmailAccount`. Plaintext columns mean a leaked backup, a compromised read replica, or an over-scoped DB user hands an attacker working Gmail credentials. FEATURES.md required deciding this **before** OAuth ships. Options considered: an external secrets store (Vault / KMS-wrapped rows), hand-rolled encrypt/decrypt helpers called at each site, or a Prisma client extension.

**Decision:** AES-256-GCM field encryption enforced by a Prisma **query extension** (`src/lib/email-token-encryption.ts`) applied to the singleton in `src/lib/prisma.ts`. Every top-level `prisma.emailAccount` write encrypts both token fields (plain strings and `{ set }` forms); every read decrypts. The key is `EMAIL_TOKEN_KEY` — 32 bytes base64 (`openssl rand -base64 32`), per-environment, never committed. The wire format is versioned (`v1:<iv>:<tag>:<ciphertext>`) so a future key/algorithm rotation can introduce `v2` and re-encrypt lazily. Crypto primitives live in `src/lib/email-token-crypto.ts`.

**Trade-offs:**
- (+) Feature code (the upcoming OAuth flow) can't forget to encrypt — the data layer does it
- (+) No new infrastructure; works the same on Vercel, local dev, and the test container
- (+) Authenticated encryption (GCM) — tampered ciphertext fails loudly instead of decrypting to garbage
- (-) Key management is on us: losing `EMAIL_TOKEN_KEY` orphans stored tokens (mitigation: users just reconnect their accounts; tokens are re-obtainable credentials, not data)
- (-) Token fields are not queryable by value (acceptable — nothing should ever `WHERE accessToken = ...`)
- (-) **Nested writes/reads through other models bypass the hook** (`prisma.user.update({ data: { emailAccounts: { create … } } })` would store plaintext; `include: { emailAccounts: true }` returns ciphertext). Convention: always touch tokens through `prisma.emailAccount.*`. Reads fail safe (ciphertext, not a leak).

**Ripple:** Extending the client changed the `$transaction` callback type, so helper params that used `Prisma.TransactionClient` now use the `Tx` type exported from `src/lib/prisma.ts`.

**Scope addendum (same day):** `MessengerAccount` carried the same time bomb (`accessToken` / `refreshToken` / `webhookSecret` for the Quo phone integration), so the extension covers both models — same key, same wire format, `webhookSecret` included.
