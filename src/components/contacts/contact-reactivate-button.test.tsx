/**
 * Tests for the Reactivate button (deactivated contact's detail page).
 * Confirm first (cancel = no action), refresh on success, alert the
 * server's reason on failure.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));
vi.mock("@/app/actions/contacts", () => ({ reactivateContact: vi.fn() }));

import { reactivateContact } from "@/app/actions/contacts";
import { ContactReactivateButton } from "./contact-reactivate-button";

const mockedReactivate = vi.mocked(reactivateContact);
const alertMock = vi.fn();
const confirmMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockedReactivate.mockResolvedValue({ ok: true });
  confirmMock.mockReturnValue(true);
  vi.stubGlobal("alert", alertMock);
  vi.stubGlobal("confirm", confirmMock);
});

describe("ContactReactivateButton", () => {
  test("confirms, reactivates and refreshes", async () => {
    const user = userEvent.setup();
    render(<ContactReactivateButton contactId="c1" contactName="Dana" />);

    await user.click(screen.getByRole("button", { name: /reactivate/i }));

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('"Dana"')
    );
    await waitFor(() => expect(mockedReactivate).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  test("cancelling the confirm never calls the action", async () => {
    confirmMock.mockReturnValue(false);
    const user = userEvent.setup();
    render(<ContactReactivateButton contactId="c1" contactName="Dana" />);

    await user.click(screen.getByRole("button", { name: /reactivate/i }));

    expect(mockedReactivate).not.toHaveBeenCalled();
  });

  test("alerts the server's reason on failure and does not refresh", async () => {
    mockedReactivate.mockResolvedValue({ ok: false, error: "Merged" });
    const user = userEvent.setup();
    render(<ContactReactivateButton contactId="c1" contactName="Dana" />);

    await user.click(screen.getByRole("button", { name: /reactivate/i }));

    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("Merged"));
    expect(refresh).not.toHaveBeenCalled();
  });
});
