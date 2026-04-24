# Kosloski Law CRM — Project Documentation

This folder contains living documentation for the CRM build. These files are maintained collaboratively between Jason and Claude as the project evolves.

## Files

| File | Purpose |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, tech stack decisions, folder structure, data flow patterns |
| [FEATURES.md](./FEATURES.md) | Feature roadmap — planned, in-progress, and completed features with scope and status |
| [SCHEMA_NOTES.md](./SCHEMA_NOTES.md) | Data model decisions, trade-offs, and evolution notes as the schema grows |
| [UI_PATTERNS.md](./UI_PATTERNS.md) | Reusable UI patterns, component conventions, and design system implementation notes |
| [DECISIONS.md](./DECISIONS.md) | Architectural Decision Records (ADRs) — why we chose X over Y |
| [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) | Unresolved questions, parking lot items, and things to revisit |

## How we use these docs

- **Before building a feature:** Check FEATURES.md for scope, SCHEMA_NOTES.md for data model implications, and OPEN_QUESTIONS.md for unresolved dependencies.
- **During implementation:** Update status in FEATURES.md, note any decisions in DECISIONS.md, and capture patterns in UI_PATTERNS.md.
- **After completing a feature:** Mark it done in FEATURES.md, document any schema changes in SCHEMA_NOTES.md, and clean up resolved items in OPEN_QUESTIONS.md.
