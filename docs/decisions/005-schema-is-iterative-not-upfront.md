# ADR-005: Schema is iterative, not upfront

**Date:** 2026-04-24
**Status:** Accepted

**Context:** The initial schema covers 25 models from the design handoff, but the design data model is WIP. Real requirements will emerge during implementation.

**Decision:** Treat the Prisma schema as a living document. Build each feature end-to-end and adjust the schema as needed. Don't over-engineer models for features we haven't started building.

**Rationale:** Prisma migrations are incremental and cheap. It's better to evolve the schema with real requirements than to guess upfront and end up with unused fields or wrong relationships.
