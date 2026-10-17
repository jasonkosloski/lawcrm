/**
 * /settings/activity — `firm.view_activity` page gate + filter plumbing.
 *
 * The audit query does no permission check of its own, so the page
 * is the enforcement point. Also pinned: the viewer's time zone is
 * handed to the query (the from/to day filters must cut on the
 * viewer's calendar days, matching the timestamps the page shows),
 * junk `?type=` values fall back to "All", and the filter controls
 * are labelled.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));
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
vi.mock("@/lib/queries/firm-activity", () => ({
  getFirmActivity: vi.fn(async () => []),
  listFirmActivityAuthors: vi.fn(async () => []),
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import {
  getFirmActivity,
  listFirmActivityAuthors,
} from "@/lib/queries/firm-activity";
import FirmActivityPage from "./page";

const mockedHasPermission = vi.mocked(currentUserHasPermission);

const props = (sp: Record<string, string | string[]> = {}) =>
  ({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(sp),
  }) as unknown as Parameters<typeof FirmActivityPage>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/settings/activity page gate", () => {
  test("without firm.view_activity: redirects home and reads no audit rows", async () => {
    mockedHasPermission.mockResolvedValue(false);

    await expect(FirmActivityPage(props())).rejects.toThrow("NEXT_REDIRECT:/");

    expect(mockedHasPermission).toHaveBeenCalledWith("firm.view_activity");
    expect(getFirmActivity).not.toHaveBeenCalled();
    expect(listFirmActivityAuthors).not.toHaveBeenCalled();
  });

  test("with the key: queries in the viewer's zone with the parsed filters", async () => {
    mockedHasPermission.mockResolvedValue(true);

    render(
      await FirmActivityPage(
        props({ type: "communications", from: "2026-10-15", to: "2026-10-16" })
      )
    );

    expect(getFirmActivity).toHaveBeenCalledWith({
      types: ["email", "call"],
      userId: undefined,
      from: "2026-10-15",
      to: "2026-10-16",
      tz: "America/Denver",
    });
  });

  test("an unknown or inherited ?type= falls back to All instead of crashing", async () => {
    mockedHasPermission.mockResolvedValue(true);

    render(await FirmActivityPage(props({ type: "toString" })));

    expect(getFirmActivity).toHaveBeenCalledWith(
      expect.objectContaining({ types: undefined })
    );
  });

  test("calls, documents and evidence each have a pill", async () => {
    mockedHasPermission.mockResolvedValue(true);

    render(await FirmActivityPage(props()));

    for (const label of ["Documents", "Evidence", "Communications"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  test("the user and date filters are labelled for assistive tech", async () => {
    mockedHasPermission.mockResolvedValue(true);

    render(await FirmActivityPage(props()));

    expect(screen.getByLabelText("User")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText("From")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("To")).toHaveAttribute("type", "date");
  });
});
