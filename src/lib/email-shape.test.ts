import { describe, expect, test } from "vitest";
import { isLenientEmail } from "./email-shape";

describe("isLenientEmail", () => {
  test.each(["dana@example.com", "a.b+tag@sub.example.co", "  dana@example.com  "])(
    "accepts %j",
    (v) => expect(isLenientEmail(v)).toBe(true)
  );

  test.each(["", "nope", "dana@", "@example.com", "dana@example", "a b@c.com", "a@b@c.com"])(
    "rejects %j",
    (v) => expect(isLenientEmail(v)).toBe(false)
  );
});
