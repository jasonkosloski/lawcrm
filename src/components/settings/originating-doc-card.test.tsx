import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/firm", () => ({
  setRequireOriginatingDoc: vi.fn(async () => ({ ok: true })),
}));

import { setRequireOriginatingDoc } from "@/app/actions/firm";
import { OriginatingDocCard } from "./originating-doc-card";

beforeEach(() => vi.clearAllMocks());

describe("OriginatingDocCard", () => {
  test("explains new-matters-only and shows the missing count", () => {
    render(<OriginatingDocCard current={false} missingCount={7} />);
    expect(screen.getByText(/new matters only/i)).toBeTruthy();
    expect(screen.getByText(/7 open matters/i)).toBeTruthy();
  });

  test("toggling calls the action with the new value", async () => {
    render(<OriginatingDocCard current={false} missingCount={0} />);
    await userEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(setRequireOriginatingDoc).toHaveBeenCalledWith(true)
    );
  });
});
