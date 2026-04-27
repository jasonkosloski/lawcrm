/**
 * Vitest configuration.
 *
 * Test layers (read top-down for the discipline):
 *   1. Unit tests for pure helpers in `src/lib/**` — fast, no DB,
 *      no React rendering. Run on every commit.
 *   2. Component / hook tests for client components — happy-dom
 *      environment. Mock server actions; assert UI behavior.
 *   3. Server-action / query integration tests — sqlite test DB,
 *      seeded fixtures, real Prisma.
 *
 * Today the suite focuses on layer 1 (pure helpers). The
 * configuration leaves the infrastructure for 2 + 3 ready —
 * happy-dom is wired in, the path alias matches the app, and the
 * `setupFiles` slot is here so DB seeding hooks land cleanly when
 * we add them.
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
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
