# ADR-062: Transcription runs at a third-party provider, on request only, and the provider's copy is deleted

**Date:** 2026-10-21
**Status:** Accepted.

**Context:** Recordings (bodycam, interviews, client calls, depositions) are privileged or sensitive evidence. A usable transcript needs speaker labels and word timings, which means a hosted speech-to-text provider (AssemblyAI). Sending every upload there automatically would put all media in a third party's hands without anyone deciding to, and bytes must not travel through our functions in production (ADR-034).

**Decision:**

- A transcript is made only when a user with `documents.transcribe` asks for one on a specific audio/video document. No auto-transcribe on upload, no batch.
- In production the provider fetches the file from a short-lived presigned URL; our functions never carry the bytes. In local dev (no public URL) the server uploads the bytes to the provider instead.
- The provider's copy is deleted once the result is stored. Failure, timeout and mid-flight document or transcript deletion also purge it: when the provider refuses, the job id lands in `transcript_purges` (a BEFORE DELETE trigger on `transcripts` queues in-flight jobs) and the sweep retries.
- Webhooks are verified by a per-job secret and only trigger a re-fetch of the result; the payload is never trusted. The webhook origin is `AUTH_URL`, else `VERCEL_PROJECT_PRODUCTION_URL`; when neither is known (or storage is local) no webhook is registered and the cron sweep is the fallback that finishes the job. The sweep also covers lost deliveries. Language is auto-detected (`language_detection`). Provider error text has URLs stripped (it can echo the presigned media link) before it is stored or notified.
- Transcripts are internal work product: not exposed in the client portal.
- A monthly hour cap (`TRANSCRIPTION_MONTHLY_HOURS`) bounds spend. Reusing a completed transcript for a copied document is free and checked before the cap.
- The firm must sign the provider's zero-retention / BAA terms before production use.

**Trade-offs:**

- (+) Nothing leaves the system unless a person chose to send it; the provider holds a file only while a job runs
- (+) One provider adapter (`src/lib/transcription/`) keeps a second provider a small change
- (-) Recordings still reach a third party on request, so the contract terms matter
- (-) The cap is checked from completed durations, so jobs in flight can overshoot it
- (-) Purge needs a trigger and a retry table to cover cascade deletes
