/**
 * /intake/[id]/documents/[documentId] — the viewer is scoped to the
 * lead; a document outside it 404s (no matter wall on leads).
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Lead wall (ADR-049) is unit-tested in src/lib/lead-access.test.ts;
// pages are pinned to call it by src/app/page-guards.test.ts.
vi.mock("@/lib/lead-access", () => ({
  assertLeadAccess: vi.fn(async () => "u1"),
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/components/documents/document-viewer-body", () => ({
  DocumentViewerBody: (props: { scope: unknown; documentId: string }) => (
    <div data-testid="viewer" data-props={JSON.stringify(props)} />
  ),
}));

import LeadDocumentViewerPage from "./page";

afterEach(() => vi.clearAllMocks());

describe("LeadDocumentViewerPage", () => {
  test("renders the shared viewer with the lead scope and document id", async () => {
    const ui = await LeadDocumentViewerPage({
      params: Promise.resolve({ id: "lead_1", documentId: "d1" }),
      searchParams: Promise.resolve({}),
    } as Parameters<typeof LeadDocumentViewerPage>[0]);
    render(ui);
    expect(JSON.parse(screen.getByTestId("viewer").getAttribute("data-props")!)).toMatchObject({
      scope: { kind: "lead", leadId: "lead_1" },
      documentId: "d1",
    });
  });
});
