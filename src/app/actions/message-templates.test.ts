/**
 * Integration tests for the email / text template actions: permission per
 * kind, scope fit, recipient handling, subject rendering, missing-data
 * reporting and the email formatting note. Record access itself is the
 * loader's (load-data.test.ts); here a walled record must still refuse.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { listMessageTemplateOptions, renderMessageTemplate } from "@/app/actions/message-templates";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedLead,
  seedMatter,
  seedMatterContact,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let firmId: string;
let matterId: string;
let clientId: string;
let M: { kind: "matter"; matterId: string };

const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });
const fieldNode = (path: string) => ({ type: "field", attrs: { path, format: null } });
const jsonDoc = (...blocks: unknown[]) =>
  ({ type: "doc", content: blocks }) as unknown as Prisma.InputJsonValue;

async function template(data: {
  kind: string;
  appliesTo?: string;
  content: Prisma.InputJsonValue;
  subject?: Prisma.InputJsonValue;
  isActive?: boolean;
  name?: string;
}) {
  const row = await prisma.documentTemplate.create({
    data: { name: data.name ?? "T", appliesTo: "both", isActive: true, ...data },
    select: { id: true },
  });
  return row.id;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.mocked(currentUserHasPermission).mockReset();
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
  ({ firmId } = await seedFirm());
  userId = (await seedUser({ firmId, name: "Test Attorney" })).userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(getCurrentFirm).mockResolvedValue({
    id: firmId,
    name: "Test Firm LLC",
    shortName: null,
    ein: null,
    website: null,
    phone: null,
    email: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zip: null,
    country: "US",
    establishedAt: null,
    logoUrl: null,
  } as Awaited<ReturnType<typeof getCurrentFirm>>);
  const { areaId, stageId } = await seedPracticeArea();
  clientId = (await seedContact({ name: "Maria Alvarez", email: "maria@example.com" })).contactId;
  matterId = (
    await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Alvarez v. City",
    })
  ).matterId;
  M = { kind: "matter", matterId };
  await prisma.matter.update({ where: { id: matterId }, data: { clientId } });
});

describe("renderMessageTemplate", () => {
  test("fills an email's subject and body against the matter", async () => {
    const id = await template({
      kind: "email",
      content: jsonDoc(para(text("Dear "), fieldNode("client.name"), text(","))),
      subject: jsonDoc(para(text("Re: "), fieldNode("matter.name"))),
    });
    const res = await renderMessageTemplate(id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.subject).toBe("Re: Alvarez v. City");
    expect(res.html).toContain("Dear Maria Alvarez,");
    expect(res.text.trim()).toBe("Dear Maria Alvarez,");
    expect(res.needsRecipient).toBe(false);
    expect(res.dropsFormatting).toBe(false);
    expect(currentUserHasPermission).toHaveBeenCalledWith("communication.send_email");
  });

  test("text templates need the call-log key and return plain text only", async () => {
    const id = await template({
      kind: "sms",
      content: jsonDoc(para(text("Hi "), fieldNode("client.name"))),
    });
    const res = await renderMessageTemplate(id, M);
    expect(res).toMatchObject({ ok: true, kind: "sms", html: "", subject: null });
    expect(currentUserHasPermission).toHaveBeenCalledWith("communication.log_call");

    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    expect(await renderMessageTemplate(id, M)).toEqual({
      ok: false,
      error: "You don't have permission to log texts.",
    });
  });

  test("uses the chosen recipient, and refuses one that isn't on the record", async () => {
    const counsel = (await seedContact({ name: "Pat Counsel", email: "pat@law.example" }))
      .contactId;
    await seedMatterContact({ matterId, contactId: counsel, category: "opposing" });
    const stranger = (await seedContact({ name: "Stranger" })).contactId;
    const id = await template({
      kind: "email",
      content: jsonDoc(para(text("To "), fieldNode("recipient.name"))),
    });

    const res = await renderMessageTemplate(id, M, { recipientContactId: counsel });
    expect(res).toMatchObject({ ok: true, needsRecipient: true });
    if (res.ok) expect(res.text).toContain("To Pat Counsel");

    const refused = await renderMessageTemplate(id, M, { recipientContactId: stranger });
    expect(refused.ok).toBe(false);
  });

  test("reports missing data without a recipient", async () => {
    const id = await template({
      kind: "email",
      content: jsonDoc(para(text("To "), fieldNode("recipient.name"))),
    });
    const res = await renderMessageTemplate(id, M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.missing.length).toBe(1);
    expect(res.text).toContain("not on file");
  });

  test("refuses letters, archived templates and the wrong scope", async () => {
    const letter = await template({ kind: "letter", content: jsonDoc(para(text("x"))) });
    expect(await renderMessageTemplate(letter, M)).toEqual({
      ok: false,
      error: "This template isn't an email or text template.",
    });
    const archived = await template({
      kind: "email",
      isActive: false,
      content: jsonDoc(para(text("x"))),
    });
    expect((await renderMessageTemplate(archived, M)).ok).toBe(false);
    const leadOnly = await template({
      kind: "email",
      appliesTo: "lead",
      content: jsonDoc(para(text("x"))),
    });
    expect(await renderMessageTemplate(leadOnly, M)).toEqual({
      ok: false,
      error: "This template is for leads only.",
    });
  });

  test("flags formatting the email editor drops", async () => {
    const id = await template({
      kind: "email",
      content: jsonDoc({
        type: "heading",
        attrs: { level: 2, textAlign: "center" },
        content: [text("Centered")],
      }),
    });
    const res = await renderMessageTemplate(id, M);
    expect(res).toMatchObject({ ok: true, dropsFormatting: true });
  });

  test("a restricted matter the user isn't on is refused before rendering", async () => {
    const { areaId, stageId } = await seedPracticeArea({ name: "Other" });
    const other = await seedUser({ firmId, name: "Other Lawyer" });
    const walled = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: other.userId,
      name: "Walled",
    });
    await prisma.matter.update({ where: { id: walled.matterId }, data: { restricted: true } });
    const id = await template({ kind: "email", content: jsonDoc(para(text("x"))) });
    await expect(
      renderMessageTemplate(id, { kind: "matter", matterId: walled.matterId }),
    ).rejects.toThrow();
  });
});

describe("listMessageTemplateOptions", () => {
  test("lists active templates of the kind that fit the scope, plus record contacts", async () => {
    await template({ kind: "email", name: "Status update", content: jsonDoc(para(text("x"))) });
    await template({
      kind: "email",
      name: "Lead only",
      appliesTo: "lead",
      content: jsonDoc(para(text("x"))),
    });
    await template({ kind: "sms", name: "Reminder", content: jsonDoc(para(text("x"))) });
    const res = await listMessageTemplateOptions("email", M);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.templates.map((t) => t.name)).toEqual(["Status update"]);
    expect(res.recipients).toEqual([
      expect.objectContaining({ id: clientId, email: "maria@example.com", role: "client" }),
    ]);
  });

  test("lead scope offers lead and both templates", async () => {
    const { leadId } = await seedLead({ contactId: clientId });
    await template({ kind: "sms", name: "Both", content: jsonDoc(para(text("x"))) });
    await template({
      kind: "sms",
      name: "Matter only",
      appliesTo: "matter",
      content: jsonDoc(para(text("x"))),
    });
    const res = await listMessageTemplateOptions("sms", { kind: "lead", leadId });
    expect(res.ok && res.templates.map((t) => t.name)).toEqual(["Both"]);
  });
});

describe("renderMessageTemplate formatting note", () => {
  test("centered paragraphs and underline are kept, so they do not warn", async () => {
    const id = await template({
      kind: "email",
      content: jsonDoc({
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [{ type: "text", text: "Hi", marks: [{ type: "underline" }] }],
      }),
    });
    expect(await renderMessageTemplate(id, M)).toMatchObject({ ok: true, dropsFormatting: false });
  });

  test("an H1 with left alignment still counts", async () => {
    const id = await template({
      kind: "email",
      content: jsonDoc({
        type: "heading",
        attrs: { level: 1, textAlign: "left" },
        content: [text("Big")],
      }),
    });
    expect(await renderMessageTemplate(id, M)).toMatchObject({ ok: true, dropsFormatting: true });
  });

  test("a table inside an inserted block counts", async () => {
    const block = await prisma.templateBlock.create({
      data: {
        key: "tbl",
        name: "Table block",
        content: jsonDoc({
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [para(text("cell"))] }],
            },
          ],
        }),
      },
      select: { id: true },
    });
    const id = await template({
      kind: "email",
      content: jsonDoc({ type: "block", attrs: { blockId: block.id } }),
    });
    expect(await renderMessageTemplate(id, M)).toMatchObject({ ok: true, dropsFormatting: true });
  });

  test("a stored block loop renders without overflowing", async () => {
    const a = await prisma.templateBlock.create({
      data: { key: "a", name: "A", content: jsonDoc(para(text("a"))) },
      select: { id: true },
    });
    const b = await prisma.templateBlock.create({
      data: { key: "b", name: "B", content: jsonDoc({ type: "block", attrs: { blockId: a.id } }) },
      select: { id: true },
    });
    await prisma.templateBlock.update({
      where: { id: a.id },
      data: { content: jsonDoc({ type: "block", attrs: { blockId: b.id } }) },
    });
    const id = await template({
      kind: "email",
      content: jsonDoc({ type: "block", attrs: { blockId: a.id } }),
    });
    expect(await renderMessageTemplate(id, M)).toMatchObject({ ok: true, dropsFormatting: false });
  });
});
