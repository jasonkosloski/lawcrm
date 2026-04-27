/**
 * Vitest configuration.
 *
 * Test layers (read top-down for the discipline):
 *   1. Unit tests for pure helpers in `src/lib/**` — fast, no DB,
 *      no React rendering. Run on every commit.
 *   2. Component / hook tests for client components — happy-dom
 *      environment. Mock server actions; assert UI behavior.
 *   3. Server-action / query integration tests — sqlite test DB,
 *      seeded fixtures, real Prisma. See `src/test/integration-*`.
 *
 * Why happy-dom over jsdom: faster boot + closer-to-modern-DOM
 * behavior. Trade-off is slightly less compatibility with quirky
 * libraries; we haven't hit any.
 */

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Layer-3 integration tests need a real test SQLite DB.
    // `globalSetup` runs once before any test file, points
    // DATABASE_URL at the test DB, and pushes the schema. See
    // `src/test/integration-setup.ts` for the full lifecycle.
    globalSetup: ["./src/test/integration-setup.ts"],
    // Integration tests share a single SQLite test DB and reset
    // it via `beforeEach` (see `src/test/integration-helpers.ts`).
    // Vitest's default file-level parallelism would race on that
    // shared state — file A truncating the DB while file B's
    // test is mid-flight. `fileParallelism: false` runs files
    // one-at-a-time. Tests within a file still run in document
    // order with sequential `beforeEach` calls, which is exactly
    // what the resetDb pattern needs.
    //
    // Trade-off: layer 1 + 2 tests are pure / no-DB and could
    // safely run in parallel. We're paying ~1s wall-clock for
    // simplicity. Revisit by routing layers through separate
    // configs if the suite ever blows past 30s.
    fileParallelism: false,
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
      // Floors set just below current coverage so a legitimate
      // refactor doesn't trip them, but a regression (or a new
      // big un-tested file landing in `src/lib/` /
      // `src/app/actions/`) does. Raise these numbers as more
      // helpers + actions get covered. Don't lower them — if a
      // change *would* lower coverage, fix the test suite first.
      thresholds: {
        lines: 17,
        statements: 17,
        functions: 17,
        branches: 15,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
