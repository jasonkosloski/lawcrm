import { describe, expect, test } from "vitest";
import { isBodyEmpty } from "./email-signature-body";

const SIG = "<p></p><p>-- </p><p>Jane Doe</p>";

describe("isBodyEmpty", () => {
  test("empty editor scaffolding is empty", () => {
    expect(isBodyEmpty("<p></p>", null)).toBe(true);
    expect(isBodyEmpty("<p></p>", SIG)).toBe(true);
  });

  test("the untouched signature alone is empty", () => {
    expect(isBodyEmpty(SIG, SIG)).toBe(true);
  });

  test("text above the signature is a message", () => {
    expect(isBodyEmpty(`<p>Thanks!</p><p>-- </p><p>Jane Doe</p>`, SIG)).toBe(false);
    expect(isBodyEmpty("<p>Thanks!</p>", null)).toBe(false);
  });
});
