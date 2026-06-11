/**
 * Vitest global setup.
 *
 * Wires `@testing-library/jest-dom` matchers (toBeInTheDocument,
 * toHaveValue, etc) so test files don't have to import them
 * individually. Also provides the canonical place to add global
 * polyfills / mocks as the suite grows.
 *
 * Referenced from `vitest.config.ts` via `setupFiles`.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Deterministic 32-byte key so integration tests can exercise the
// EmailAccount token encryption extension (src/lib/email-token-
// encryption.ts) without each test wiring its own env. setupFiles
// run inside every worker, so this reaches all test processes —
// globalSetup wouldn't. Unit tests that probe key-handling edge
// cases save/override/restore this themselves.
process.env.EMAIL_TOKEN_KEY ??= Buffer.alloc(32, 7).toString("base64");

// Auto-cleanup after each test — unmounts any rendered components
// so matchers from prior tests don't leak. RTL ships this for
// Jest by default but Vitest needs the manual hookup.
afterEach(() => {
  cleanup();
});
