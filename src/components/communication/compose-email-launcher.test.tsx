/**
 * ComposeEmailLauncher (async server component) - permission gate and
 * the sendable-status / provider / ownership filter on the account
 * query. Awaited directly; the client button is stubbed.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailAccount: {
      findMany: vi.fn().mockResolvedValue([{ id: "a1", emailAddress: "me@firm.com" }]),
    },
  },
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn().mockResolvedValue("u1"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/queries/communication", () => ({
  getFilingMatterOptions: vi.fn().mockResolvedValue([{ id: "m1" }]),
  getFilingLeadOptions: vi.fn().mockResolvedValue([{ id: "l1" }]),
}));
vi.mock("@/lib/email-signature", () => ({
  getEmailSignature: vi.fn(async () => "<p>SIG</p>"),
}));
vi.mock("./compose-email", () => ({ ComposeEmailButton: () => null }));

import { prisma } from "@/lib/prisma";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getFilingLeadOptions, getFilingMatterOptions } from "@/lib/queries/communication";
import { SENDABLE_EMAIL_STATUSES } from "@/lib/email-send-status";
import { ComposeEmailButton } from "./compose-email";
import { ComposeEmailLauncher } from "./compose-email-launcher";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
  vi.mocked(prisma.emailAccount.findMany).mockResolvedValue([
    { id: "a1", emailAddress: "me@firm.com" },
  ] as never);
});

describe("ComposeEmailLauncher", () => {
  test("renders nothing without communication.send_email (and never queries)", async () => {
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    expect(await ComposeEmailLauncher()).toBeNull();
    expect(prisma.emailAccount.findMany).not.toHaveBeenCalled();
    expect(getFilingMatterOptions).not.toHaveBeenCalled();
    expect(getFilingLeadOptions).not.toHaveBeenCalled();
  });

  test("passes record options and initialScope to the button", async () => {
    const scope = { kind: "lead", leadId: "l1" } as const;
    const el = (await ComposeEmailLauncher({ initialScope: scope })) as {
      props: Record<string, unknown>;
    };
    expect(el.props.matters).toEqual([{ id: "m1" }]);
    expect(el.props.leads).toEqual([{ id: "l1" }]);
    expect(el.props.initialScope).toEqual(scope);
    expect(el.props.signature).toBe("<p>SIG</p>");
  });

  test("lists only the caller's gmail accounts in a sendable status", async () => {
    const el = (await ComposeEmailLauncher()) as {
      type: unknown;
      props: { accounts: unknown };
    };
    expect(el.type).toBe(ComposeEmailButton);
    expect(el.props.accounts).toEqual([{ id: "a1", emailAddress: "me@firm.com" }]);
    expect(prisma.emailAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "u1",
          provider: "gmail",
          syncStatus: { in: [...SENDABLE_EMAIL_STATUSES] },
        },
      }),
    );
  });
});
