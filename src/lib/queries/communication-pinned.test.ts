/**
 * Integration tests for the communication rail's per-matter badge
 * (getCommunicationPinnedMatters) and the Log-call contact picker
 * (listContactPickerOptions).
 *
 * Pinned-matter badge: the rail link opens the matter under the
 * default Inbox filter (not archived, not snoozed), so the badge must
 * count only those rows or it reads "Smith v. Jones 7" over a list of
 * 3.
 *
 * Picker: it preloads the first 500 contacts alphabetically; a
 * matter's own client / parties that sort past the cap must still be
 * selectable.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getCommunicationPinnedMatters } from "@/lib/queries/communication";
import { listContactPickerOptions } from "@/lib/queries/contacts";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedMatterContact,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
const mockedGetUser = vi.mocked(getCurrentUserId);

let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  mockedGetUser.mockResolvedValue(userId);
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Smith v. Jones",
  }));
});

describe("getCommunicationPinnedMatters - badge matches the Inbox rows", () => {
  test("archived and snoozed threads are not counted", async () => {
    await prisma.userMatterPin.create({ data: { userId, matterId } });
    const account = await prisma.emailAccount.create({
      data: { userId, emailAddress: "me@firm.test" },
      select: { id: true },
    });
    const thread = (extra: Record<string, unknown>) =>
      prisma.emailThread.create({
        data: {
          accountId: account.id,
          matterId,
          subject: "s",
          messageCount: 1,
          lastMessageAt: new Date("2026-06-01T10:00:00Z"),
          ...extra,
        },
      });
    await thread({}); // visible
    await thread({ followUpAt: new Date("2020-01-01T00:00:00Z") }); // snooze expired -> visible
    await thread({ isArchived: true }); // hidden
    await thread({ followUpAt: new Date("2999-01-01T00:00:00Z") }); // snoozed -> hidden

    const pins = await getCommunicationPinnedMatters();
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ id: matterId, threadCount: 2 });
  });

  test("a pin with no visible threads is still returned with a zero count", async () => {
    await prisma.userMatterPin.create({ data: { userId, matterId } });
    const pins = await getCommunicationPinnedMatters();
    expect(pins).toEqual([expect.objectContaining({ id: matterId, threadCount: 0 })]);
  });
});

describe("listContactPickerOptions - matter people beyond the 500-row cap", () => {
  test("the matter's client / party past the alphabetical cap is merged in first", async () => {
    await prisma.contact.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        name: `Aaa Filler ${String(i).padStart(3, "0")}`,
        type: "client",
        isActive: true,
      })),
    });
    const { contactId: partyId } = await seedContact({ name: "Zamora, Luis" });
    await seedMatterContact({
      matterId,
      contactId: partyId,
      category: "opposing_party",
    });

    const rows = await listContactPickerOptions({ priorityMatterId: matterId });

    expect(rows).toHaveLength(501);
    // Past the cap by name, yet selectable - and floated to the top.
    expect(rows[0]).toMatchObject({ id: partyId, name: "Zamora, Luis" });
    // No duplicates.
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  test("without a priority matter the list is the plain capped A-Z list", async () => {
    await seedContact({ name: "Beta" });
    await seedContact({ name: "Alpha" });
    const rows = await listContactPickerOptions();
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
  });
});
