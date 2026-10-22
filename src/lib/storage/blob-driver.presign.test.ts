/**
 * signedBlobUrl against the REAL @vercel/blob `presignUrl` (F059/F063).
 *
 * The unit tests in blob-driver.test.ts mock `presignUrl`, which hid a
 * production bug: the SDK concatenates the raw pathname into a URL
 * without encoding, so names containing `#`, `?` or `%` produced a URL
 * pointing at a truncated/malformed path (view + download 403/404). Here
 * only the network call (`issueSignedToken`) is stubbed; `presignUrl`,
 * the URL construction and the HMAC signature are the SDK's own, and the
 * function under test is `signedBlobUrl` itself.
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return { ...actual, issueSignedToken: vi.fn() };
});

import { issueSignedToken } from "@vercel/blob";
import { signedBlobUrl } from "./blob-driver";

const STORE_ID = "abc123";
const STORE = `https://${STORE_ID}.private.blob.vercel-storage.com`;
const SIGNING_TOKEN = "signing-secret";
const NOW = new Date("2026-10-16T12:00:00Z").getTime();

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

/** Stub issueSignedToken the way the Blob API answers: a delegation
 *  token whose payload carries the scope the SDK checks. `encoding`
 *  says how non-ASCII pathname characters travel in the payload JSON:
 *  "raw" — UTF-8 bytes, which is what the live API sends (a macOS
 *  screenshot name, "…5.07.24 PM.png" with U+202F before "PM", failed
 *  in production this way); "escaped" — \uXXXX escapes. Both must work. */
function stubToken(encoding: "raw" | "escaped" = "raw") {
  vi.mocked(issueSignedToken).mockImplementation(async (opts) => {
    const payload = {
      storeId: `store_${STORE_ID}`,
      pathname: opts?.pathname,
      operations: opts?.operations,
      validUntil: opts?.validUntil,
    };
    const raw = JSON.stringify(payload);
    const json =
      encoding === "raw"
        ? raw
        : raw.replace(
            /[\u0080-\uffff]/g,
            (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
          );
    return {
      delegationToken: `${b64url(json)}.sig`,
      clientSigningToken: SIGNING_TOKEN,
      validUntil: opts?.validUntil as number,
    };
  });
}

/** The signature the server will recompute: HMAC over the canonical
 *  string of the DECODED pathname (ADR-018, verified live). */
function expectedSignature(pathname: string): string {
  const canonical = [`operation=get`, `pathname=${pathname}`].sort().join("\n");
  return createHmac("sha256", SIGNING_TOKEN).update(canonical).digest("base64url");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  stubToken();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const RAND = "AAAAAAAAAAAAAAAA";

/** Build the stored (SDK `put`) URL for a pathname the way the browser
 *  / WHATWG URL parser encodes it. */
function storedUrl(pathname: string): string {
  return `${STORE}/${pathname.split("/").map(encodeURIComponent).join("/")}`;
}

describe.each([
  ["plain", `${RAND}__brief.pdf`],
  ["space", `${RAND}__brief v2.pdf`],
  ["hash", `${RAND}__Exhibit #3.pdf`],
  ["leading hash", `${RAND}__#12 bodycam.mp4`],
  ["question mark", `${RAND}__What happened?.docx`],
  ["percent", `${RAND}__100% done.pdf`],
  ["percent-escape lookalike", `${RAND}__a%20b%23c.pdf`],
  ["ampersand and plus", `${RAND}__Smith & Sons + Co.pdf`],
  ["unicode", `${RAND}__résumé — 履歴書 🙂.pdf`],
  ["macOS screenshot (U+202F before PM)", `${RAND}__Screenshot 2026-09-18 at 5.07.24\u202fPM.png`],
  ["all together", `${RAND}__#1 100% (final)? a&b=c;d.pdf`],
])("signedBlobUrl with a %s name", (_label, key) => {
  test("the URL requests exactly the stored pathname, with no fragment", async () => {
    const url = new URL(await signedBlobUrl(storedUrl(key)));

    expect(url.origin).toBe(STORE);
    // The browser decodes the path to exactly the key - nothing
    // truncated at '#'/'?', nothing double-encoded.
    expect(decodeURIComponent(url.pathname.slice(1))).toBe(key);
    expect(url.hash).toBe("");
  });

  test("carries the SDK signature computed over the decoded pathname", async () => {
    const url = new URL(await signedBlobUrl(storedUrl(key)));

    expect(url.searchParams.get("vercel-blob-signature")).toBe(expectedSignature(key));
    expect(url.searchParams.get("vercel-blob-delegation")).toBeTruthy();
    // Query holds ONLY SDK params - no junk keys from a '?' in the name.
    for (const name of url.searchParams.keys()) {
      expect(name).toMatch(/^vercel-blob-/);
    }
    // The token was scoped to the decoded key, get-only.
    expect(vi.mocked(issueSignedToken).mock.calls[0][0]).toMatchObject({
      pathname: key,
      operations: ["get"],
    });
  });

  test("download=1 is appended outside the signed params", async () => {
    const url = new URL(await signedBlobUrl(storedUrl(key), { download: true }));
    expect(url.searchParams.get("download")).toBe("1");
    expect(url.searchParams.get("vercel-blob-signature")).toBe(expectedSignature(key));
    expect(decodeURIComponent(url.pathname.slice(1))).toBe(key);
  });
});

describe("signedBlobUrl robustness", () => {
  test("non-ASCII names also sign when the issuer escapes them", async () => {
    stubToken("escaped");
    const key = `${RAND}__résumé — 履歴書 🙂.pdf`;
    const url = new URL(await signedBlobUrl(storedUrl(key)));
    expect(url.searchParams.get("vercel-blob-signature")).toBe(expectedSignature(key));
  });

  test("the global atob is left exactly as it was", async () => {
    const before = globalThis.atob;
    await signedBlobUrl(storedUrl(`${RAND}__résumé.pdf`));
    expect(globalThis.atob).toBe(before);
    expect(atob(btoa("é"))).toBe("é"); // still the latin-1 builtin
  });

  test("a stored URL with an invalid percent escape does not throw", async () => {
    // e.g. a literal '%' that was never encoded: decodeURIComponent
    // would throw a URIError; the path falls back to the raw form.
    const url = await signedBlobUrl(`${STORE}/${RAND}__bad%zz.pdf`);
    expect(new URL(url).searchParams.get("vercel-blob-signature")).toBeTruthy();
  });
});
