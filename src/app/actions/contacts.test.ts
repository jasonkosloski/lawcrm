/**
 * Integration tests for the contact directory actions.
 *
 * Covers:
 *   - auth gate: every mutation resolves the session via
 *     getCurrentUserId() before touching the DB (the proxy only
 *     checks cookie presence, so this call is the real check)
 *   - create: contact + primary ContactPhone row, redirect target
 *   - update phone sync: primary-row upsert, max(order)+1 placement
 *     when non-primary rows already exist (no order-0 collision),
 *     and clear-phone promoting the lowest-order survivor so the
 *     one-primary / Contact.phone-mirror invariant holds
 *   - delete: unconditional soft-delete via isActive=false
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  createContact,
  deleteContact,
  updateContact,
} from "@/app/actions/contacts";
import { contactFormInitialState } from "@/lib/contact-form";
import { resetDb, seedContact } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

function contactForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    name: "Dana Whitfield",
    type: "client",
    email: "dana@example.com",
    phone: "",
    organization: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    notes: "",
    conflictStatus: "clear",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  mockedGetUser.mockReset();
  mockedGetUser.mockResolvedValue("test-user");
  vi.mocked(redirect).mockClear();
});

describe("auth gate", () => {
  // getCurrentUserId() throws a redirect to /login for invalid
  // sessions — simulate that and verify each mutation bails before
  // any DB write.
  const bounce = new Error("NEXT_REDIRECT:/login");

  test("createContact bounces unauthenticated callers before writing", async () => {
    mockedGetUser.mockRejectedValue(bounce);
    await expect(
      createContact(contactFormInitialState, contactForm())
    ).rejects.toThrow(bounce);
    expect(await prisma.contact.count()).toBe(0);
  });

  test("updateContact bounces unauthenticated callers before writing", async () => {
    const { contactId } = await seedContact({ name: "Before" });
    mockedGetUser.mockRejectedValue(bounce);
    await expect(
      updateContact(contactId, contactFormInitialState, contactForm())
    ).rejects.toThrow(bounce);
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.name).toBe("Before");
  });

  test("deleteContact bounces unauthenticated callers before writing", async () => {
    const { contactId } = await seedContact();
    mockedGetUser.mockRejectedValue(bounce);
    await expect(deleteContact(contactId)).rejects.toThrow(bounce);
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.isActive).toBe(true);
  });
});

describe("createContact", () => {
  test("creates the contact plus a primary phone row and redirects", async () => {
    await createContact(
      contactFormInitialState,
      contactForm({ phone: "(303) 555-0101" })
    );

    const c = await prisma.contact.findFirstOrThrow({
      include: { phones: true },
    });
    expect(c.name).toBe("Dana Whitfield");
    expect(c.phone).toBe("(303) 555-0101");
    expect(c.phones).toHaveLength(1);
    expect(c.phones[0]).toMatchObject({
      number: "(303) 555-0101",
      isPrimary: true,
      order: 0,
    });
    expect(redirect).toHaveBeenCalledWith(`/contacts/${c.id}`);
  });

  test("no phone row is written when phone is blank", async () => {
    await createContact(contactFormInitialState, contactForm());
    expect(await prisma.contactPhone.count()).toBe(0);
  });

  test("returns field errors instead of writing on invalid input", async () => {
    const res = await createContact(
      contactFormInitialState,
      contactForm({ name: "" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.name).toBeTruthy();
    expect(await prisma.contact.count()).toBe(0);
  });
});

describe("updateContact phone sync", () => {
  test("updates the existing primary row in place", async () => {
    const { contactId } = await seedContact();
    await prisma.contactPhone.create({
      data: {
        contactId,
        number: "111",
        isPrimary: true,
        order: 0,
      },
    });

    const res = await updateContact(
      contactId,
      contactFormInitialState,
      contactForm({ phone: "222" })
    );
    expect(res.status).toBe("ok");

    const phones = await prisma.contactPhone.findMany({ where: { contactId } });
    expect(phones).toHaveLength(1);
    expect(phones[0]).toMatchObject({ number: "222", isPrimary: true });
  });

  test("new primary lands at max(order)+1 when non-primary rows exist", async () => {
    // Parties-tab writes start at order 0 — the directory form must
    // not collide with them.
    const { contactId } = await seedContact();
    await prisma.contactPhone.createMany({
      data: [
        { contactId, label: "Office", number: "111", isPrimary: false, order: 0 },
        { contactId, label: "Fax", number: "222", isPrimary: false, order: 1 },
      ],
    });

    const res = await updateContact(
      contactId,
      contactFormInitialState,
      contactForm({ phone: "333" })
    );
    expect(res.status).toBe("ok");

    const phones = await prisma.contactPhone.findMany({
      where: { contactId },
      orderBy: { order: "asc" },
    });
    expect(phones.map((p) => p.order)).toEqual([0, 1, 2]);
    const primary = phones.filter((p) => p.isPrimary);
    expect(primary).toHaveLength(1);
    expect(primary[0]).toMatchObject({ number: "333", order: 2 });
  });

  test("clearing the phone promotes the lowest-order survivor to primary", async () => {
    const { contactId } = await seedContact();
    await prisma.contact.update({
      where: { id: contactId },
      data: { phone: "111" },
    });
    await prisma.contactPhone.createMany({
      data: [
        { contactId, label: "Cell", number: "111", isPrimary: true, order: 0 },
        { contactId, label: "Office", number: "222", isPrimary: false, order: 1 },
        { contactId, label: "Fax", number: "333", isPrimary: false, order: 2 },
      ],
    });

    const res = await updateContact(
      contactId,
      contactFormInitialState,
      contactForm({ phone: "" })
    );
    expect(res.status).toBe("ok");

    const phones = await prisma.contactPhone.findMany({
      where: { contactId },
      orderBy: { order: "asc" },
    });
    // Old primary is gone; exactly one survivor is primary and the
    // denormalized column mirrors it.
    expect(phones).toHaveLength(2);
    expect(phones.filter((p) => p.isPrimary)).toHaveLength(1);
    expect(phones[0]).toMatchObject({ number: "222", isPrimary: true });

    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBe("222");
  });

  test("clearing the only phone leaves no rows and a null Contact.phone", async () => {
    const { contactId } = await seedContact();
    await prisma.contact.update({
      where: { id: contactId },
      data: { phone: "111" },
    });
    await prisma.contactPhone.create({
      data: { contactId, number: "111", isPrimary: true, order: 0 },
    });

    const res = await updateContact(
      contactId,
      contactFormInitialState,
      contactForm({ phone: "" })
    );
    expect(res.status).toBe("ok");

    expect(await prisma.contactPhone.count({ where: { contactId } })).toBe(0);
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBeNull();
  });

  test("errors when the contact no longer exists", async () => {
    const res = await updateContact(
      "gone",
      contactFormInitialState,
      contactForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/no longer exists/i);
  });
});

describe("deleteContact", () => {
  test("always soft-deletes — the row survives with isActive=false", async () => {
    const { contactId } = await seedContact();
    const res = await deleteContact(contactId);
    expect(res.ok).toBe(true);

    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.isActive).toBe(false);
  });

  test("reports a missing contact", async () => {
    const res = await deleteContact("gone");
    expect(res).toEqual({ ok: false, error: "Contact not found" });
  });
});
