import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/matter-agreement", () => ({
  updateMatterAgreement: vi.fn(async () => ({ status: "ok" })),
}));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));

import { AgreementCard } from "./agreement-card";

const base = {
  matterId: "m1",
  label: "Fee agreement",
  documents: [{ id: "d1", name: "fee.pdf" }],
  canEdit: false,
  required: false,
};

beforeEach(() => vi.clearAllMocks());

describe("AgreementCard", () => {
  test("shows signed date and a link to the document viewer", () => {
    render(
      <AgreementCard
        {...base}
        agreement={{
          status: "signed",
          signedDate: "2026-10-12",
          document: { id: "d1", name: "fee.pdf" },
        }}
      />,
    );
    expect(screen.getByText(/Signed 2026-10-12/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /view document/i }).getAttribute("href")).toBe(
      "/matters/m1/documents/d1",
    );
  });

  test("shows the empty state with the area's label", () => {
    render(<AgreementCard {...base} label="Retainer" agreement={null} />);
    expect(screen.getByText("No Retainer on file")).toBeTruthy();
  });

  test("hides Edit without permission and shows the form with it", async () => {
    const { rerender } = render(<AgreementCard {...base} agreement={null} />);
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    rerender(<AgreementCard {...base} canEdit agreement={null} />);
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(document.querySelector('select[name="agreementStatus"]')).toBeTruthy();
    expect(document.querySelector('select[name="documentId"]')).toBeTruthy();
  });

  test("Cancel discards edits and reopens at the saved values", async () => {
    const user = userEvent.setup();
    render(
      <AgreementCard
        {...base}
        canEdit
        agreement={{ status: "sent", signedDate: null, document: { id: "d1", name: "fee.pdf" } }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const status = () =>
      document.querySelector('select[name="agreementStatus"]') as HTMLSelectElement;
    const doc = () => document.querySelector('select[name="documentId"]') as HTMLSelectElement;
    await user.selectOptions(status(), "signed");
    await user.selectOptions(doc(), "");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(status().value).toBe("sent");
    expect(doc().value).toBe("d1");
  });

  test("renders server errors under status / date / document and posts one name per value", async () => {
    const { updateMatterAgreement } = await import("@/app/actions/matter-agreement");
    vi.mocked(updateMatterAgreement).mockResolvedValueOnce({
      status: "error",
      errors: {
        status: ["Mark the Fee agreement as signed."],
        signedDate: ["Enter the date it was signed."],
        documentId: ["Attach the signed Fee agreement."],
      },
    });
    const user = userEvent.setup();
    render(<AgreementCard {...base} canEdit required agreement={null} />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    // No duplicate hidden mirrors: only the visible controls post these values.
    expect(document.querySelector('input[name="status"]')).toBeNull();
    expect(document.querySelector('input[name="signedDate"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText("Mark the Fee agreement as signed.")).toBeTruthy();
    expect(screen.getByText("Enter the date it was signed.")).toBeTruthy();
    expect(screen.getByText("Attach the signed Fee agreement.")).toBeTruthy();
  });
});
