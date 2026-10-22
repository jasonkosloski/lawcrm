# Kosloski Law CRM: project docs

Living documentation, maintained by Jason and Claude as the project evolves.
Load only what the task needs: the roadmap, one feature file, and the ADRs
it links. The rules for what goes where are in the root `AGENTS.md`
("Docs are non-optional").

## Planning and history

| Path                           | What's in it                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------- |
| [ROADMAP.md](./ROADMAP.md)     | Priority-ordered open work, one line each, linking to detail                      |
| [features/](./features/)       | One file per feature area: what shipped, what's open, related ADRs, key files     |
| [issues/](./issues/)           | Open problems and product calls too big for a roadmap line; deleted when resolved |
| [decisions/](./decisions/)     | One ADR per file; index in `decisions/README.md`                                  |
| [superpowers/](./superpowers/) | In-flight specs and plans (temporary; deleted when the feature ships)             |

## How we work

| File                                         | What's in it                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)         | Stack, folder structure, data-flow patterns, security model            |
| [PERMISSIONS.md](./PERMISSIONS.md)           | Permission model, guards, page-guard rule, matter-team access          |
| [TESTING.md](./TESTING.md)                   | Testing discipline, layers, Docker test DB, commands                   |
| [UI_PATTERNS.md](./UI_PATTERNS.md)           | Reusable UI patterns and component conventions                         |
| [SCHEMA_NOTES.md](./SCHEMA_NOTES.md)         | Data-model principles, invariants, pending and rejected changes        |
| [DEPLOY_BACKFILLS.md](./DEPLOY_BACKFILLS.md) | One-off data repairs to run once per environment after certain deploys |

Setup, environment variables, the seed guard and the test database are in
the root [README.md](../README.md); `.env.example` is the env-var reference.
