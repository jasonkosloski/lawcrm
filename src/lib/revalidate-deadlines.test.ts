import { describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { revalidateDeadlineSurfaces } from "./revalidate-deadlines";

describe("revalidateDeadlineSurfaces", () => {
  test("refreshes the deadlines tab, matter, dashboard and calendar", () => {
    revalidateDeadlineSurfaces("m1");
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["/matters/m1/deadlines", "/matters/m1", "/", "/calendar"]);
  });
});
