/**
 * Role-name constants — client-safe.
 *
 * These names are referenced by both server and client code (the
 * member-edit form needs the "default" name to disable that
 * checkbox), so they live here without any Prisma / server-only
 * imports. Server-only helpers (`isCurrentUserAdmin`, `requireAdmin`,
 * etc.) live in `src/lib/firm.ts` and re-export these for one-stop
 * server-side imports.
 */

/// Reserved role name that grants admin powers. The seed creates
/// this row with `isSystem = true` per firm; the role-management
/// UI blocks rename + delete on system roles. Single source of
/// truth — change once, not in N permission checks.
export const ADMIN_ROLE_NAME = "Admin";

/// Reserved role name auto-assigned to every new user. Holds no
/// permissions today; future granular permissions hang off this row.
export const DEFAULT_ROLE_NAME = "default";
