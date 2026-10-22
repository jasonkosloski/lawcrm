/**
 * NewRequestComposer: an ad hoc pick reveals the type-name and due-date
 * inputs and posts an empty typeId; a typed pick hides them.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createMock = vi.fn();
vi.mock("@/app/actions/records-requests", () => ({
  createRecordsRequest: (...a: unknown[]) => createMock(...a),
  createCustodianContact: vi.fn(),
}));
vi.mock("@/app/actions/attendee-search", () => ({
  searchAttendeesAction: vi.fn(async () => [
    {
      kind: "contact",
      id: "c1",
      name: "St. Mary's",
      email: null,
      type: "medical_provider",
      organization: null,
    },
    { kind: "user", id: "u9", name: "A User", email: "a@x.com", initials: "AU", jobTitle: "" },
  ]),
}));

import { NewRequestComposer } from "./new-request-composer";

const SCOPE = { kind: "matter", matterId: "m1" } as const;
const TYPES = [{ id: "t1", name: "Medical records" }];
const USERS = [{ id: "u1", name: "Me" }];

async function open(user: ReturnType<typeof userEvent.setup>, canCreateContact = true) {
  render(
    <NewRequestComposer
      scope={SCOPE}
      types={TYPES}
      users={USERS}
      currentUserId="u1"
      canCreateContact={canCreateContact}
    />,
  );
  await user.click(screen.getByRole("button", { name: /new records request/i }));
}

async function pickCustodian(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Search custodians"), "St");
  await user.click(await screen.findByRole("button", { name: /St\. Mary's/ }));
}

beforeEach(() => createMock.mockReset());

describe("NewRequestComposer", () => {
  test("ad hoc reveals type-name + due date and posts typeId=''", async () => {
    createMock.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    await open(user);
    expect(screen.queryByLabelText("Type of records")).toBeNull();
    expect(screen.queryByLabelText("Response due date")).toBeNull();

    await pickCustodian(user);
    await user.selectOptions(screen.getByLabelText("Type"), "Ad hoc (other)");
    await user.type(screen.getByLabelText("Type of records"), "Employment file");
    expect(screen.getByLabelText("Response due date")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Subject"), "Personnel file");
    await user.click(screen.getByRole("button", { name: "Create request" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const [scope, , fd] = createMock.mock.calls[0] as [unknown, unknown, FormData];
    expect(scope).toEqual(SCOPE);
    expect(fd.get("typeId")).toBe("");
    expect(fd.get("adHocTypeName")).toBe("Employment file");
    expect(fd.get("custodianContactId")).toBe("c1");
    expect(fd.get("subject")).toBe("Personnel file");
    expect(fd.get("ownerId")).toBe("u1");
  });

  test("a typed pick posts the type id and hides the ad hoc inputs", async () => {
    createMock.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    await open(user);
    await pickCustodian(user);
    expect(screen.queryByLabelText("Type of records")).toBeNull();
    await user.type(screen.getByLabelText("Subject"), "ER chart");
    await user.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const fd = createMock.mock.calls[0][2] as FormData;
    expect(fd.get("typeId")).toBe("t1");
    expect(fd.has("adHocTypeName")).toBe(false);
  });

  test("a server error keeps the typed input", async () => {
    createMock.mockResolvedValue({
      status: "error",
      errors: { subject: ["Subject is required"] },
    });
    const user = userEvent.setup();
    await open(user);
    await pickCustodian(user);
    await user.type(screen.getByLabelText("Subject"), "ER chart");
    await user.click(screen.getByRole("button", { name: "Create request" }));
    expect(await screen.findByText("Subject is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue("ER chart");
    expect(screen.getByText("St. Mary's")).toBeInTheDocument();
  });

  test("quick-create is hidden without contacts.create", async () => {
    const user = userEvent.setup();
    await open(user, false);
    expect(screen.queryByRole("button", { name: /new custodian/i })).toBeNull();
  });
});
