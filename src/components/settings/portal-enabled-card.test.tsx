import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/firm", () => ({ setPortalEnabled: vi.fn() }));

import { setPortalEnabled } from "@/app/actions/firm";
import { PortalEnabledCard } from "./portal-enabled-card";

afterEach(() => vi.clearAllMocks());

describe("PortalEnabledCard", () => {
  test("toggling calls setPortalEnabled with the new value", async () => {
    vi.mocked(setPortalEnabled).mockResolvedValue({ ok: true });
    render(<PortalEnabledCard current={false} />);
    await userEvent.setup().click(screen.getByRole("switch"));
    await waitFor(() => expect(setPortalEnabled).toHaveBeenCalledWith(true));
  });

  test("a failed save reverts the switch and shows the error", async () => {
    vi.mocked(setPortalEnabled).mockResolvedValue({ ok: false, error: "Nope." });
    render(<PortalEnabledCard current={false} />);
    await userEvent.setup().click(screen.getByRole("switch"));
    expect(await screen.findByText("Nope.")).toBeTruthy();
    expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(false);
  });
});
