/**
 * Tests for MailboxDrawer.
 *
 * The regression worth pinning: the closed drawer used to render
 * `aria-hidden={!open ? undefined : false}` — an expression that
 * can never be true — so on mobile the off-canvas rail's links
 * stayed keyboard-focusable and exposed to screen readers. The fix
 * applies `inert` when the drawer is closed *and* the viewport is
 * below `lg`; at `lg+` the same element is the always-visible rail
 * and must never be inert.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mutable so a test can "navigate". The provider closes the drawer
// when the location (path + query string) changes, so re-renders with
// the same location must not re-close it.
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/communication",
  useSearchParams: () => searchParams,
}));

import {
  MailboxDrawer,
  MailboxDrawerProvider,
  MailboxDrawerTrigger,
} from "./mailbox-drawer";

/** Stub matchMedia so `useIsDesktop` sees a fixed viewport —
 *  happy-dom's own media-query evaluation isn't reliable enough to
 *  drive breakpoint tests. */
function mockViewport(desktop: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: desktop,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }) as unknown as MediaQueryList
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  searchParams = new URLSearchParams();
});

function renderDrawer() {
  render(
    <MailboxDrawerProvider>
      <MailboxDrawerTrigger label="Inbox" />
      <MailboxDrawer>
        <a href="/communication?filter=sent">Sent folder</a>
      </MailboxDrawer>
    </MailboxDrawerProvider>
  );
  // The drawer container is the close button's direct parent — the
  // only stable handle on it (it renders no landmark role itself).
  const container = screen.getByRole("button", {
    name: "Close folder list",
  }).parentElement!;
  return container;
}

describe("MailboxDrawer — closed drawer is inert on mobile only", () => {
  test("mobile: closed drawer is inert; opening removes it; closing restores it", async () => {
    mockViewport(false);
    const user = userEvent.setup();
    const container = renderDrawer();

    // Closed: off-canvas links must be out of the tab order / a11y tree.
    expect(container).toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Open folder list" }));
    expect(container).not.toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Close folder list" }));
    expect(container).toHaveAttribute("inert");
  });

  test("desktop: the persistent rail is never inert, even while 'closed'", () => {
    mockViewport(true);
    const container = renderDrawer();

    // `open` is false by default, but at lg+ the element is the
    // always-visible rail — inert here would make it unclickable.
    expect(container).not.toHaveAttribute("inert");
  });
});

describe("MailboxDrawer - trigger state + auto-close", () => {
  function renderWithRerender() {
    const ui = () => (
      <MailboxDrawerProvider>
        <MailboxDrawerTrigger label="Inbox" />
        <MailboxDrawer>
          <a href="/communication?filter=sent">Sent folder</a>
        </MailboxDrawer>
      </MailboxDrawerProvider>
    );
    const view = render(ui());
    return { rerender: () => view.rerender(ui()) };
  }

  test("the trigger exposes aria-expanded", async () => {
    mockViewport(false);
    const user = userEvent.setup();
    renderWithRerender();
    const trigger = screen.getByRole("button", { name: "Open folder list" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  test("picking a folder (query change) closes the drawer; a same-location re-render does not", async () => {
    mockViewport(false);
    const user = userEvent.setup();
    const { rerender } = renderWithRerender();
    const container = screen.getByRole("button", { name: "Close folder list" })
      .parentElement!;

    await user.click(screen.getByRole("button", { name: "Open folder list" }));
    expect(container).not.toHaveAttribute("inert");

    // Fresh URLSearchParams object, identical query: still the same
    // location, so the drawer stays open.
    searchParams = new URLSearchParams();
    rerender();
    expect(container).not.toHaveAttribute("inert");

    // A different query string is a navigation: close.
    searchParams = new URLSearchParams("filter=sent");
    rerender();
    expect(container).toHaveAttribute("inert");
  });
});
