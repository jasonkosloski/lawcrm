import { describe, expect, test } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblems,
} from "./password-policy";

describe("passwordProblems", () => {
  test("accepts a long passphrase with no composition rules", () => {
    expect(passwordProblems("correct horse battery")).toEqual([]);
  });

  test("rejects anything under the minimum length", () => {
    const short = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    expect(passwordProblems(short)).toEqual([
      `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    ]);
    expect(passwordProblems("a".repeat(PASSWORD_MIN_LENGTH))).toEqual([]);
  });

  test("caps length so argon2 can't be fed huge inputs", () => {
    expect(passwordProblems("a".repeat(PASSWORD_MAX_LENGTH))).toEqual([]);
    expect(passwordProblems("a".repeat(PASSWORD_MAX_LENGTH + 1))).toEqual([
      `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
    ]);
  });

  test("rejects the account email, case- and whitespace-insensitively", () => {
    expect(
      passwordProblems(" JKosloski@KosloskiLaw.com ", {
        email: "jkosloski@kosloskilaw.com",
      })
    ).toEqual(["Don't use your email address as your password."]);
  });

  test("email check is a no-op without an email", () => {
    expect(passwordProblems("someone@example.com", { email: null })).toEqual(
      []
    );
  });
});
