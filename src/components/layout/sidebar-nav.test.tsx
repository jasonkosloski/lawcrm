/**
 * Tests for SidebarNav.
 *
 * The regression worth pinning: the drawer used to render
 * `aria-hidden={!open ? undefined : false}` — an expression that
 * can never be true — so on mobile the off-canvas sidebar's ~20
 * controls (nav links, ⌘K, sign-out) stayed keyboard-focusable and
 * exposed to screen readers. The fix applies `inert` when the
 * drawer is closed *and* the viewport is below `lg`; at `lg+` the
 * same element is the always-visible column and must never be
 * inert.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Stable instances — SidebarNav auto-closes the drawer when the
// pathname changes, so a mock returning fresh values each render
// would re-close it after every render and mask the open state.
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/matters",
  useSearchParams: () => searchParams,
}));

// Pure anchor stand-in — the sidebar only needs href-based links.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Context provider + server action are irrelevant to drawer a11y.
vi.mock("@/components/command-palette/command-palette-provider", () => ({
  useCommandPalette: () => ({ openPalette: vi.fn() }),
}));
vi.mock("@/app/actions/auth", () => ({
  logoutAction: vi.fn(),
}));

import { SidebarNav } from "./sidebar-nav";
import { MobileNavProvider, useMobileNav } from "./mobile-nav-provider";
import type { SidebarData } from "@/lib/queries/sidebar";

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
});

const emptyData: SidebarData = {
  currentUser: null,
  openMatterCount: 0,
  unreadEmailCount: 0,
  activeLeadCount: 0,
  hoursToday: 0,
  pinnedMatters: [],
  areaCounts: [],
};

/** The hamburger lives in the topbar in the real app; a minimal
 *  stand-in wired to the same context is enough here. */
function OpenNavButton() {
  const { toggle } = useMobileNav();
  return (
    <button type="button" onClick={toggle}>
      Open navigation
    </button>
  );
}

function renderSidebar() {
  const { container } = render(
    <MobileNavProvider>
      <OpenNavButton />
      <SidebarNav data={emptyData} />
    </MobileNavProvider>
  );
  // Query the DOM directly — role-based queries exclude inert
  // subtrees, which is the very state under test.
  return container.querySelector("aside")!;
}

describe("SidebarNav — Time nav item", () => {
  test("links to the standalone /time page", () => {
    mockViewport(true);
    const aside = renderSidebar();

    const timeLink = aside.querySelector('a[href="/time"]');
    expect(timeLink).not.toBeNull();
    // Label only — zero hours today means no badge noise.
    expect(timeLink!.textContent).toBe("Time");
  });

  test("shows today's hours as the badge when > 0", () => {
    mockViewport(true);
    const { container } = render(
      <MobileNavProvider>
        <SidebarNav data={{ ...emptyData, hoursToday: 2.5 }} />
      </MobileNavProvider>
    );

    const timeLink = container.querySelector('a[href="/time"]');
    expect(timeLink!.textContent).toContain("2.5h");
  });
});

describe("SidebarNav — closed drawer is inert on mobile only", () => {
  test("mobile: closed drawer is inert; opening removes it; closing restores it", async () => {
    mockViewport(false);
    const user = userEvent.setup();
    const aside = renderSidebar();

    // Closed: off-canvas links must be out of the tab order / a11y tree.
    expect(aside).toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(aside).not.toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(aside).toHaveAttribute("inert");
  });

  test("desktop: the persistent column is never inert, even while 'closed'", () => {
    mockViewport(true);
    const aside = renderSidebar();

    // `open` is false by default, but at lg+ the element is the
    // always-visible column — inert here would make it unusable.
    expect(aside).not.toHaveAttribute("inert");
  });
});
