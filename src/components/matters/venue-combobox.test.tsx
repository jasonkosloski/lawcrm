import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VenueOption } from "@/lib/queries/venues";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/venues", () => ({ createVenue: create }));

import { VenueCombobox } from "./venue-combobox";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

const aurora: VenueOption = {
  id: "v1",
  name: "Aurora",
  city: "Aurora",
  county: "Arapahoe",
  state: "CO",
  isActive: true,
};

let lastChange: VenueOption | null | undefined;

function Harness({ canAdd = true, venues = [aurora] }: { canAdd?: boolean; venues?: VenueOption[] }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <form>
      <VenueCombobox
        name="venueId"
        venues={venues}
        value={value}
        onChange={(v) => {
          lastChange = v;
          setValue(v?.id ?? null);
        }}
        canAdd={canAdd}
        defaultState="CO"
      />
    </form>
  );
}

const hidden = () =>
  document.querySelector<HTMLInputElement>('input[name="venueId"]')!;

beforeEach(() => {
  create.mockReset();
  lastChange = undefined;
});

describe("VenueCombobox", () => {
  test("typing lists matching venues with the full label", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.type(screen.getByRole("combobox"), "aur");
    expect(screen.getByText("Aurora · Aurora, Arapahoe, CO")).toBeTruthy();
    await u.click(screen.getByText("Aurora · Aurora, Arapahoe, CO"));
    expect(hidden().value).toBe("v1");
  });

  test("Enter on an unmatched name opens the add popover prefilled; save selects the new venue", async () => {
    const u = userEvent.setup();
    const fresh = { ...aurora, id: "v2", name: "Auroa" };
    create.mockResolvedValue({ ok: true, venue: fresh });
    render(<Harness />);
    await u.type(screen.getByRole("combobox"), "Auroa");
    expect(screen.getByText('Press Enter to add "Auroa"')).toBeTruthy();
    await u.keyboard("{Enter}");
    expect((await screen.findByLabelText("Name") as HTMLInputElement).value).toBe("Auroa");
    expect((screen.getByLabelText("State") as HTMLInputElement).value).toBe("CO");
    await u.click(screen.getByRole("button", { name: "Save venue" }));
    await waitFor(() => expect(lastChange?.id).toBe("v2"));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Auroa", state: "CO" })
    );
    expect(hidden().value).toBe("v2");
  });

  test("code exists selects the returned venue", async () => {
    const u = userEvent.setup();
    create.mockResolvedValue({ ok: false, code: "exists", venue: aurora });
    render(<Harness />);
    await u.type(screen.getByRole("combobox"), "Auroa");
    await u.keyboard("{Enter}");
    await u.click(await screen.findByRole("button", { name: "Save venue" }));
    await waitFor(() => expect(hidden().value).toBe("v1"));
  });

  test("code archived shows the restore message", async () => {
    const u = userEvent.setup();
    create.mockResolvedValue({
      ok: false,
      code: "archived",
      venue: { ...aurora, isActive: false },
    });
    render(<Harness />);
    await u.type(screen.getByRole("combobox"), "Auroa");
    await u.keyboard("{Enter}");
    await u.click(await screen.findByRole("button", { name: "Save venue" }));
    expect(
      await screen.findByText('"Auroa" is archived. Restore it in Settings → Venues.')
    ).toBeTruthy();
    expect(hidden().value).toBe("");
  });

  test("without canAdd: no-match copy, hidden input stays empty after blur", async () => {
    const u = userEvent.setup();
    render(<Harness canAdd={false} />);
    await u.type(screen.getByRole("combobox"), "Zzz");
    expect(screen.getByText("No venue matches. Ask an admin to add it.")).toBeTruthy();
    await u.tab();
    expect(hidden().value).toBe("");
  });

  test("blank state blocks Save", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.type(screen.getByRole("combobox"), "Auroa");
    await u.keyboard("{Enter}");
    await u.clear(await screen.findByLabelText("State"));
    await u.click(screen.getByRole("button", { name: "Save venue" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText("State is required.")).toBeTruthy();
  });
});
