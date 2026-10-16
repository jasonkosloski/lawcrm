import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./cron-auth";

const req = (authorization?: string): Request =>
  new Request("https://example.test/api/x", {
    headers: authorization ? { authorization } : {},
  });

describe("isAuthorizedCron", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret-value";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("accepts the exact bearer", () => {
    expect(isAuthorizedCron(req("Bearer s3cret-value"))).toBe(true);
  });

  it("rejects a missing header, wrong secret, wrong scheme and wrong length", () => {
    expect(isAuthorizedCron(req())).toBe(false);
    expect(isAuthorizedCron(req("Bearer s3cret-valuX"))).toBe(false);
    expect(isAuthorizedCron(req("Bearer s3cret"))).toBe(false);
    expect(isAuthorizedCron(req("Bearer s3cret-value-and-more"))).toBe(false);
    expect(isAuthorizedCron(req("Basic s3cret-value"))).toBe(false);
    expect(isAuthorizedCron(req("s3cret-value"))).toBe(false);
  });

  it("fails closed when CRON_SECRET is unset or empty", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCron(req("Bearer undefined"))).toBe(false);
    expect(isAuthorizedCron(req("Bearer "))).toBe(false);
    process.env.CRON_SECRET = "";
    expect(isAuthorizedCron(req("Bearer "))).toBe(false);
  });
});
