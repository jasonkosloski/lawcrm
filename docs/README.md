# Kosloski Law CRM — Project Documentation

This folder contains living documentation for the CRM build. These files are maintained collaboratively between Jason and Claude as the project evolves.

## Files

| File | Purpose |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, tech stack, folder structure, data flow patterns |
| [FEATURES.md](./FEATURES.md) | Feature roadmap — planned, in-progress, and completed features with scope and status |
| [SCHEMA_NOTES.md](./SCHEMA_NOTES.md) | Data model decisions, trade-offs, and evolution notes as the schema grows |
| [PERMISSIONS.md](./PERMISSIONS.md) | Permission model — granular keys, roles, guard helpers, page-guard rule, and matter-team access (ethical walls) |
| [TESTING.md](./TESTING.md) | Testing discipline — what to test, layer conventions, Docker test DB, running commands |
| [UI_PATTERNS.md](./UI_PATTERNS.md) | Reusable UI patterns, component conventions, design system implementation notes |
| [DECISIONS.md](./DECISIONS.md) | Architectural Decision Records (ADRs) — why we chose X over Y |
| [DEPLOY_BACKFILLS.md](./DEPLOY_BACKFILLS.md) | One-off idempotent data repairs to run once per environment after certain deploys |
| [AUTH_PLAN.md](./AUTH_PLAN.md) | Auth strategy and status — Phase 1 (email + password) and Phase 2 hardening (lockout, change password, session revocation) shipped; MFA, email reset, SSO deferred |

## How we use these docs

- **Before building a feature:** Check FEATURES.md for scope, SCHEMA_NOTES.md for data model implications, and PERMISSIONS.md for how to gate it.
- **During implementation:** Update status in FEATURES.md, note any decisions in DECISIONS.md, and capture patterns in UI_PATTERNS.md.
- **After completing a feature:** Mark it done in FEATURES.md, document any schema changes in SCHEMA_NOTES.md, and add permission keys to the code (PERMISSIONS.md documents the model, not the key list — `src/lib/permissions.ts` is the source of truth).

Setup, environment variables, the seed guard and the test database are
covered in the root [README.md](../README.md); `.env.example` is the
reference for env vars.

Doc maintenance is part of shipping, not a follow-up chore — see the "Docs are non-optional" section in the root `AGENTS.md`.
