import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const identity = { identityId: "", contactId: "", email: "jane@example.com" };
vi.mock("@/lib/portal-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/portal-access")>()),
  requirePortalIdentity: vi.fn(async () => identity),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/actions/portal-messages-client", () => ({
  sendPortalMessage: vi.fn(),
  markPortalMessagesRead: vi.fn(),
}));
vi.mock("./portal-uploader", () => ({
  PortalUploader: (p: { requestId?: string; label?: string }) => (
    <button data-testid="uploader" data-request={p.requestId ?? ""}>
      {p.label ?? "Upload files"}
    </button>
  ),
}));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));

import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import PortalMatterPage from "./page";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let invited: string;
let staffId: string;
let other: string;

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId });
  staffId = userId;
  const { areaId, stageId } = await seedPracticeArea();
  const { contactId } = await seedContact({ email: "jane@example.com" });
  const ident = await prisma.portalIdentity.create({
    data: { contactId, email: "jane@example.com" },
  });
  identity.identityId = ident.id;
  invited = (
    await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Smith Estate",
    })
  ).matterId;
  other = (
    await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Secret Matter",
    })
  ).matterId;
  await prisma.portalMatterAccess.create({
    data: { identityId: ident.id, matterId: invited, invitedById: userId },
  });
});

describe("portal matter page", () => {
  test("matter page 404s for an un-invited matter and shows the name for an invited one", async () => {
    await expect(
      PortalMatterPage({ params: Promise.resolve({ id: other }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    render(
      await PortalMatterPage({ params: Promise.resolve({ id: invited }) }),
    );
    expect(screen.getByText("Smith Estate")).toBeTruthy();
    expect(screen.getByText("Requested from you")).toBeTruthy();
    expect(screen.getByText("Nothing requested right now")).toBeTruthy();
    expect(screen.getByText("Shared with you")).toBeTruthy();
    expect(screen.getByText("Nothing shared yet")).toBeTruthy();
    expect(screen.getByText("Your uploads")).toBeTruthy();
    expect(screen.getByText("You haven't uploaded anything yet")).toBeTruthy();
  });

  test("renders requests, shared documents and uploads", async () => {
    await prisma.firm.updateMany({ data: { portalEnabled: true } });
    const mk = (title: string, extra: object = {}) =>
      prisma.documentRequest.create({
        data: { matterId: invited, title, createdById: staffId, ...extra },
      });
    await mk("Bank statements", {
      instructions: "Last 3 months",
      dueDate: new Date("2000-01-01T00:00:00Z"),
    });
    await mk("Photo ID", { returnNote: "The photo was blurry" });
    await mk("Tax return", { status: "submitted" });
    await mk("Old thing", { status: "complete" });
    await mk("Dropped", { status: "cancelled" });
    await prisma.document.create({
      data: {
        matterId: invited,
        name: "Engagement letter.pdf",
        clientShare: "shared",
        fileUrl: "k1",
        contentType: "application/pdf",
        fileSize: 2048,
      },
    });
    const pid = await prisma.portalIdentity.findFirstOrThrow({
      select: { id: true },
    });
    await prisma.document.create({
      data: {
        matterId: invited,
        name: "my-id.jpg",
        fileUrl: "k2",
        portalUploaderId: pid.id,
        fileSize: 100,
      },
    });
    render(
      await PortalMatterPage({ params: Promise.resolve({ id: invited }) }),
    );
    expect(screen.getByText("Bank statements")).toBeTruthy();
    expect(screen.getByText("Last 3 months")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("The photo was blurry")).toBeTruthy();
    expect(screen.getByText("Tax return")).toBeTruthy();
    expect(screen.getByText("Received, the firm is reviewing")).toBeTruthy();
    expect(screen.getByText("Done (1)")).toBeTruthy();
    expect(screen.queryByText("Dropped")).toBeNull();
    const link = screen.getByText("Engagement letter.pdf").closest("a");
    expect(link?.getAttribute("href")).toMatch(
      /^\/api\/documents\/.+\/download$/,
    );
    expect(screen.getByText("my-id.jpg")).toBeTruthy();
    // one uploader per open request plus the general one
    expect(screen.getAllByTestId("uploader")).toHaveLength(3);
  });
});
