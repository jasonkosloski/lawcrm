/**
 * /settings/security — "Recent account activity" lists only the user's
 * OWN auth events (sign-ins, password changes, admin unlocks/resets
 * of THIS account), not the admin actions they performed on others,
 * which are also `type: "auth"` rows under their userId (team.ts).
 *
 * Real DB; the session guard, tz resolver and change-password form
 * (which imports the auth server actions) are stubbed.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/components/settings/change-password-form", () => ({
  ChangePasswordForm: () => <div data-testid="change-password-form" />,
}));

import { requireUser } from "@/lib/current-user";
import { AUTH_EVENT_TITLES } from "@/lib/auth-events";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import SecuritySettingsPage from "./page";

let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  vi.mocked(requireUser).mockResolvedValue(userId);
});

function row(title: string, minutesAgo: number) {
  return prisma.activityLog.create({
    data: {
      matterId: null,
      userId,
      type: "auth",
      icon: "shield",
      source: "Security",
      title,
      timestamp: new Date(Date.now() - minutesAgo * 60_000),
    },
  });
}

describe("SecuritySettingsPage", () => {
  test("shows the user's own auth events, not admin actions on other people", async () => {
    await row(AUTH_EVENT_TITLES.sign_in, 30);
    await row(AUTH_EVENT_TITLES.sign_in_unlocked, 20);
    // 20 recent admin actions would crowd the 15-row cap if unfiltered.
    for (let i = 0; i < 20; i++) await row(`Invited Person ${i} to the firm`, i + 1);
    await row("Reset password for Pat", 2);

    render(await SecuritySettingsPage());

    expect(screen.getByText(AUTH_EVENT_TITLES.sign_in)).toBeInTheDocument();
    expect(screen.getByText(AUTH_EVENT_TITLES.sign_in_unlocked)).toBeInTheDocument();
    expect(screen.queryByText(/Invited Person/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reset password for/)).not.toBeInTheDocument();
  });

  test("redirects (propagates the guard's throw) before reading anything when signed out", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(SecuritySettingsPage()).rejects.toThrow("NEXT_REDIRECT");
  });
});
