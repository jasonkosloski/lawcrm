# Kosloski Law CRM — Project Documentation

This folder contains living documentation for the CRM build. These files are maintained collaboratively between Jason and Claude as the project evolves.

## Files

| File | Purpose |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, tech stack, folder structure, data flow patterns |
| [FEATURES.md](./FEATURES.md) | Feature roadmap — planned, in-progress, and completed features with scope and status |
| [SCHEMA_NOTES.md](./SCHEMA_NOTES.md) | Data model decisions, trade-offs, and evolution notes as the schema grows |
| [PERMISSIONS.md](./PERMISSIONS.md) | Permission model — granular keys, roles, `requirePermission` conventions |
| [TESTING.md](./TESTING.md) | Testing discipline — what to test, layer conventions, running commands |
| [UI_PATTERNS.md](./UI_PATTERNS.md) | Reusable UI patterns, component conventions, design system implementation notes |
| [DECISIONS.md](./DECISIONS.md) | Architectural Decision Records (ADRs) — why we chose X over Y |
| [AUTH_PLAN.md](./AUTH_PLAN.md) | Auth strategy — Phase 1 (email + password) shipped; later phases deferred |

## How we use these docs

- **Before building a feature:** Check FEATURES.md for scope, SCHEMA_NOTES.md for data model implications, and PERMISSIONS.md for how to gate it.
- **During implementation:** Update status in FEATURES.md, note any decisions in DECISIONS.md, and capture patterns in UI_PATTERNS.md.
- **After completing a feature:** Mark it done in FEATURES.md, document any schema changes in SCHEMA_NOTES.md, and add permission keys to the code (PERMISSIONS.md documents the model, not the key list — `src/lib/permissions.ts` is the source of truth).

Doc maintenance is part of shipping, not a follow-up chore — see the "Docs are non-optional" section in the root `AGENTS.md`.
