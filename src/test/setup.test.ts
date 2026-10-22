import { describe, expect, it } from "vitest";

describe("global test setup", () => {
  it("scrubs environment variables that change code paths", () => {
    for (const name of [
      "BLOB_READ_WRITE_TOKEN",
      "STORAGE_DRIVER",
      "CRON_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "AUTH_URL",
      "VERCEL_BLOB_CALLBACK_URL",
    ]) {
      expect(process.env[name], name).toBeUndefined();
    }
  });

  it("blocks real network requests to non-loopback hosts", async () => {
    await expect(fetch("https://www.googleapis.com/gmail/v1/users/me")).rejects.toThrow(
      /Blocked real network request/,
    );
    await expect(
      fetch(new URL("https://example.public.blob.vercel-storage.com/x")),
    ).rejects.toThrow(/Blocked real network request/);
  });

  it("blocks URL-like inputs that are not instanceof URL (cross-realm)", async () => {
    const foreign = { href: "https://api.quo.com/v1/calls" } as unknown as URL;
    await expect(fetch(foreign)).rejects.toThrow(/Blocked real network request/);
  });

  it("rejects absolute-looking URLs it cannot parse instead of allowing them", async () => {
    await expect(fetch("https://")).rejects.toThrow(/Blocked/);
  });
});
