import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/actions/portal-session", () => ({
  verifyPortalLink: vi.fn(),
  requestPortalLink: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { resetDb, seedContact, seedFirm } from "@/test/integration-helpers";
import { issueToken } from "@/lib/portal/tokens";
import VerifyPage from "./page";
import LoginPage from "../../login/page";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let identityId: string;

beforeEach(async () => {
  await resetDb();
  await seedFirm();
  await prisma.firm.updateMany({ data: { portalEnabled: true } });
  const { contactId } = await seedContact({ email: "jane@example.com" });
  identityId = (
    await prisma.portalIdentity.create({
      data: { contactId, email: "jane@example.com" },
    })
  ).id;
});

describe("portal sign-in pages", () => {
  test("verify page renders a Sign in button and does not consume the token on render", async () => {
    const raw = await issueToken(identityId, "login");
    render(await VerifyPage({ searchParams: Promise.resolve({ token: raw }) }));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    const row = await prisma.portalLoginToken.findFirstOrThrow({
      where: { identityId },
    });
    expect(row.usedAt).toBeNull();
  });

  test("login shows the email form when the portal is on", async () => {
    render(await LoginPage());
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  test("login and verify pages show the portal-off copy when portalEnabled is false", async () => {
    await prisma.firm.updateMany({ data: { portalEnabled: false } });
    const copy = "The client portal is not available right now.";
    const { unmount } = render(await LoginPage());
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    unmount();
    render(await VerifyPage({ searchParams: Promise.resolve({ token: "x" }) }));
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });
});
