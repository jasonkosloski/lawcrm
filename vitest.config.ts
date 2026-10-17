/**
 * Vitest configuration.
 *
 * Test layers (read top-down for the discipline):
 *   1. Unit tests for pure helpers in `src/lib/**` — fast, no DB,
 *      no React rendering. Run on every commit.
 *   2. Component / hook tests for client components — happy-dom
 *      environment. Mock server actions; assert UI behavior.
 *   3. Server-action / query integration tests — local Postgres
 *      container (docker-compose.test.yml), seeded fixtures, real
 *      Prisma. See `src/test/integration-*`.
 *
 * Why happy-dom over jsdom: faster boot + closer-to-modern-DOM
 * behavior. Trade-off is slightly less compatibility with quirky
 * libraries; we haven't hit any.
 */

import path from "node:path";
import { defineConfig } from "vitest/config";
import { resolveMaxWorkers } from "./src/test/test-db-config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    // worker-db-setup MUST be first: it repoints DATABASE_URL at this
    // worker's own database before anything imports src/lib/prisma.
    setupFiles: ["./src/test/worker-db-setup.ts", "./src/test/setup.ts"],
    // Layer-3 integration tests need a real test Postgres.
    // `globalSetup` runs once before any test file, points
    // DATABASE_URL at the test container, takes a per-database run
    // lock, and pushes the schema. It runs for EVERY `vitest`
    // invocation, including pure unit tests, so the Docker test DB
    // must be up. See `src/test/integration-setup.ts`.
    globalSetup: ["./src/test/integration-setup.ts"],
    // Files run in parallel, each worker against its OWN database:
    // globalSetup pushes the schema once and clones it to
    // `<base>_w1..maxWorkers` (src/test/integration-setup.ts); the
    // worker-db-setup setupFile selects the clone by VITEST_POOL_ID.
    // `resetDb()` in beforeEach therefore only wipes that worker's DB.
    // Tests inside a file still run in order. maxWorkers defaults to
    // half the cores, capped at 4; override with TEST_MAX_WORKERS.
    fileParallelism: true,
    maxWorkers: resolveMaxWorkers(),
    // Match the project's TS path alias so tests import the same
    // way the app does ("@/lib/foo" instead of "../../src/lib/foo").
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "src/generated"],
    // Cap each test at 10s — anything slower is almost certainly
    // accidentally hitting the network or a real DB connection.
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/app/actions/**"],
      exclude: [
        "**/*.test.*",
        "**/__tests__/**",
        "src/generated/**",
        "src/**/*.d.ts",
      ],
      // Enforced only by `npm run test:coverage` (vitest applies
      // thresholds solely under --coverage); the commit hook runs the
      // plain suite. Floors set just below current coverage so a legitimate
      // refactor doesn't trip them, but a regression (or a new
      // big un-tested file landing in `src/lib/` /
      // `src/app/actions/`) does. Raise these numbers as more
      // helpers + actions get covered. Don't lower them — if a
      // change *would* lower coverage, fix the test suite first.
      // Figures reported by an earlier agent on 2026-10-16 (3191 tests):
      // lines 87.2, statements 85.8, functions 86.3, branches 76.7.
      // Not re-measured when the floors were set: if the first
      // `npm run test:coverage` fails on a floor, adjust it to just
      // below the real number rather than assuming a regression.
      thresholds: {
        lines: 85,
        statements: 84,
        functions: 84,
        branches: 74,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
