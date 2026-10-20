/**
 * Integration: task-assignment notifications respect the lead wall
 * (ADR-049). Assigning a restricted lead's task to someone who can't
 * see the lead must not put its name or the task title in their bell.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
import { prisma } from "@/lib/prisma";
import { notifyTaskAssigned } from "@/lib/task-assignment";
import { resetDb, seedFirm, seedLead, seedUser } from "@/test/integration-helpers";

let alice: string;
let bob: string;

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId: alice } = await seedUser({ firmId }));
  ({ userId: bob } = await seedUser({ firmId }));
});

describe("notifyTaskAssigned on intake tasks", () => {
  test("an assignee who can't see a restricted lead gets no lead name or task title", async () => {
    const { leadId } = await seedLead({
      name: "Secret Client",
      restricted: true,
      teamUserIds: [alice],
    });
    await notifyTaskAssigned({
      ownerId: bob,
      actorId: alice,
      taskTitle: "Call Secret Client re: settlement",
      matterId: null,
      leadId,
    });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: bob } });
    expect(JSON.stringify(n)).not.toContain("Secret");
    expect(n.link).not.toContain(leadId);
  });

  test("an assignee who can see the lead gets the usual ping", async () => {
    const { leadId } = await seedLead({ name: "Open Client" });
    await notifyTaskAssigned({
      ownerId: bob,
      actorId: alice,
      taskTitle: "Call back",
      matterId: null,
      leadId,
    });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: bob } });
    expect(n.title).toBe("Task assigned: Call back");
    expect(n.body).toBe("Intake · Open Client");
    expect(n.link).toBe(`/intake/${leadId}/tasks`);
  });
});
