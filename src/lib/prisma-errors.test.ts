import { describe, expect, test } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  isForeignKeyViolation,
  isRecordNotFound,
  isTransactionTimeout,
  isUniqueViolation,
} from "./prisma-errors";

function known(code: string) {
  return new Prisma.PrismaClientKnownRequestError("boom", {
    code,
    clientVersion: "test",
  });
}

describe("prisma error guards", () => {
  test("match their own code on real Prisma errors", () => {
    expect(isUniqueViolation(known("P2002"))).toBe(true);
    expect(isForeignKeyViolation(known("P2003"))).toBe(true);
    expect(isRecordNotFound(known("P2025"))).toBe(true);
    expect(isTransactionTimeout(known("P2028"))).toBe(true);
  });

  test("match plain objects carrying the code", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
  });

  test("reject other codes and non-objects", () => {
    expect(isUniqueViolation(known("P2025"))).toBe(false);
    expect(isRecordNotFound(null)).toBe(false);
    expect(isForeignKeyViolation(new Error("P2003"))).toBe(false);
  });
});
