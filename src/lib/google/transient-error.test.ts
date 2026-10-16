import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { isTransientInfraError } from "./transient-error";

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "t" });

describe("isTransientInfraError", () => {
  it.each(["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"])(
    "treats Prisma %s as transient",
    (code) => {
      expect(isTransientInfraError(known(code))).toBe(true);
    }
  );

  it("treats data-level Prisma errors as deterministic", () => {
    expect(isTransientInfraError(known("P2002"))).toBe(false);
    expect(isTransientInfraError(known("P2000"))).toBe(false);
    expect(
      isTransientInfraError(
        new Prisma.PrismaClientValidationError("bad date", { clientVersion: "t" })
      )
    ).toBe(false);
  });

  it("treats initialization failures as transient", () => {
    expect(
      isTransientInfraError(
        new Prisma.PrismaClientInitializationError("down", "t")
      )
    ).toBe(true);
  });

  it("recognizes driver-level socket / SQLSTATE codes, also on a cause", () => {
    expect(isTransientInfraError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientInfraError(Object.assign(new Error("x"), { code: "40P01" }))).toBe(true);
    expect(isTransientInfraError(new Error("wrap", { cause: { code: "08006" } }))).toBe(true);
    expect(isTransientInfraError(new Error("Connection terminated unexpectedly"))).toBe(true);
  });

  it("does not flag ordinary errors", () => {
    expect(isTransientInfraError(new Error("invalid byte sequence"))).toBe(false);
    expect(isTransientInfraError(null)).toBe(false);
    expect(isTransientInfraError("boom")).toBe(false);
  });
});
