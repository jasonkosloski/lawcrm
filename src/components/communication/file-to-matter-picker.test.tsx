/**
 * FileToMatterPicker: read-only without communication.file_email
 * (the action redirects to the dashboard on denial), and a thrown
 * action toasts instead of replacing the page with the error boundary.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const setEmailThreadMatter = vi.fn();
vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("@/app/actions/email-filing", () => ({
  setEmailThreadMatter: (...args: unknown[]) => setEmailThreadMatter(...args),
}));

import type { FilingMatterOption } from "@/lib/queries/communication";
import { notifyError } from "@/lib/feedback";
import { FileToMatterPicker } from "./file-to-matter-picker";

const options = [
  { id: "m1", name: "Smith v. Jones", color: "#123456", area: "Civil", isPinned: false },
] as unknown as FilingMatterOption[];
const current = {
  id: "m1",
  name: "Smith v. Jones",
  color: "#123456",
  area: "Civil",
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  setEmailThreadMatter.mockReset();
});

describe("without communication.file_email", () => {
  test("a filed thread shows only the matter link", () => {
    render(
      <FileToMatterPicker
        threadId="t1"
        currentMatter={current}
        options={options}
        canFile={false}
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/matters/m1");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("an unfiled thread shows a plain 'Unfiled' label, no picker", () => {
    render(
      <FileToMatterPicker
        threadId="t1"
        currentMatter={null}
        options={options}
        canFile={false}
      />
    );
    expect(screen.getByText("Unfiled")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a thrown action", () => {
  test("toasts instead of throwing out of the transition", async () => {
    setEmailThreadMatter.mockImplementation(async () => {
      throw new Error("db down");
    });
    const user = setupUser();
    render(
      <FileToMatterPicker
        threadId="t1"
        currentMatter={null}
        options={options}
      />
    );

    await user.click(screen.getByRole("button", { name: /file to matter/i }));
    await user.click(await screen.findByRole("button", { name: /Smith v\. Jones/ }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        expect.stringMatching(/try again/i)
      )
    );
  });
});
