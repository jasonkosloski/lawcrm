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

import { afterEach } from "vitest";

// Deterministic 32-byte key so integration tests can exercise the
// EmailAccount token encryption extension (src/lib/email-token-
// encryption.ts) without each test wiring its own env. setupFiles
// run inside every worker, so this reaches all test processes —
// globalSetup wouldn't. Unit tests that probe key-handling edge
// cases save/override/restore this themselves.
process.env.EMAIL_TOKEN_KEY ??= Buffer.alloc(32, 7).toString("base64");

// Hermetic environment: a developer shell that exported these (after a
// `vercel env pull`, say) must not flip the storage driver to the real
// private Blob store, turn on the cron/OAuth code paths, or change the
// derived callback URLs. Tests that need one set it themselves
// (vi.stubEnv / process.env) after this runs.
for (const name of [
  "BLOB_READ_WRITE_TOKEN",
  "STORAGE_DRIVER",
  "CRON_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_URL",
  "VERCEL_BLOB_CALLBACK_URL",
]) {
  delete process.env[name];
}

// No real network from tests. An unmocked fetch to Google, Vercel Blob
// or Quo would otherwise leave the machine (with whatever tokens a
// fixture seeded). Loopback is allowed; tests that exercise fetch
// callers mock/stub it themselves (vi.stubGlobal replaces this guard).
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Duck-typed (not `instanceof URL`): a URL from another realm
    // (happy-dom) would otherwise yield `undefined` and fail open.
    const raw =
      typeof input === "string"
        ? input
        : "href" in input
          ? String(input.href)
          : String(input.url);
    let host: string | null = null;
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      // Relative URL: no network host to protect. An absolute-looking
      // value that still fails to parse is rejected, not allowed.
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith("//")) {
        return Promise.reject(
          new Error(`Blocked unparseable network request in tests: ${raw}.`)
        );
      }
    }
    if (host !== null && !LOOPBACK.has(host)) {
      return Promise.reject(
        new Error(
          `Blocked real network request in tests: ${raw}. Mock fetch in this test.`
        )
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

// DOM-only wiring (jest-dom matchers + RTL auto-cleanup). Server-side
// files run in the node environment (see vitest.config.ts projects) and
// must not pay for importing react-dom / testing-library. A node-project
// file that opts into DOM via a `@vitest-environment happy-dom` docblock
// still gets this, because the check is on the live environment.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  // Auto-cleanup after each test — unmounts any rendered components
  // so matchers from prior tests don't leak. RTL ships this for
  // Jest by default but Vitest needs the manual hookup.
  afterEach(() => {
    cleanup();
  });
}
