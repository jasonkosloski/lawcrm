/**
 * /settings/records-types — page gate.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn(async () => "user_1") }));
vi.mock("@/lib/permission-check", () => ({ currentUserHasPermission: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/queries/records-requests", () => ({
  listRecordsRequestTypes: vi.fn(async () => [
    {
      id: "t1",
      name: "CORA",
      responseAmount: 3,
      responseUnit: "BUSINESS_DAYS",
      followUpDays: 7,
      defaultTemplateId: null,
      defaultTemplateName: null,
      isActive: true,
      sortOrder: 1,
    },
  ]),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { documentTemplate: { findMany: vi.fn(async () => []) } },
}));
vi.mock("@/components/records-requests/request-type-editor", () => ({
  RequestTypeEditor: ({ types }: { types: { name: string }[] }) => (
    <ul>{types.map((t) => <li key={t.name}>{t.name}</li>)}</ul>
  ),
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { listRecordsRequestTypes } from "@/lib/queries/records-requests";
import RecordsTypesPage from "./page";

beforeEach(() => vi.clearAllMocks());

describe("/settings/records-types", () => {
  test("without records.types.manage: notFound and no reads", async () => {
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    await expect(RecordsTypesPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(currentUserHasPermission).toHaveBeenCalledWith("records.types.manage");
    expect(listRecordsRequestTypes).not.toHaveBeenCalled();
  });

  test("with the key: lists all types including archived", async () => {
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    render(await RecordsTypesPage());
    expect(listRecordsRequestTypes).toHaveBeenCalledWith({ activeOnly: false });
    expect(screen.getByText("CORA")).toBeInTheDocument();
  });
});
