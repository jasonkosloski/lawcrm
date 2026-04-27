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

// Auto-cleanup after each test — unmounts any rendered components
// so matchers from prior tests don't leak. RTL ships this for
// Jest by default but Vitest needs the manual hookup.
afterEach(() => {
  cleanup();
});
