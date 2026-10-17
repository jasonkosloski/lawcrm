import * as argon2 from "argon2";
import { describe, expect, it } from "vitest";
import { argon2HashOptions } from "./argon2-options";

describe("argon2HashOptions", () => {
  it("production/dev use the argon2id library defaults, untouched", async () => {
    for (const env of ["production", "development", ""]) {
      expect(argon2HashOptions(env)).toEqual({ type: argon2.argon2id });
    }
    // And the defaults really are the strong parameters.
    const hash = await argon2.hash("pw", argon2HashOptions("production"));
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
  });

  it("test env uses cheap parameters that still produce verifiable argon2id", async () => {
    const opts = argon2HashOptions("test");
    expect(opts.memoryCost).toBeLessThan(65536);
    const hash = await argon2.hash("pw", opts);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(hash, "pw")).toBe(true);
    expect(await argon2.verify(hash, "nope")).toBe(false);
  });

  it("the running suite is in the test env (so app code gets the cheap path)", () => {
    expect(argon2HashOptions()).toHaveProperty("memoryCost");
  });
});
