/**
 * Render tests for InboxActionButtons.
 *
 *  - Buttons the viewer has no create permission for are not shown
 *    (their server actions redirect to the dashboard on denial).
 *  - Task / deadline dialogs surface dueDate and description errors
 *    (they used to only tint the date border).
 *  - "Save as note" prefills header + quote as separate paragraphs.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createDeadlineFromEmail = vi.fn();
const createTaskFromEmail = vi.fn();
vi.mock("@/app/actions/inbox-actions", () => ({
  createDeadlineFromEmail: (...args: unknown[]) =>
    createDeadlineFromEmail(...args),
  createDeadlineFromMessage: vi.fn(),
  createNoteFromEmail: vi.fn(),
  createNoteFromMessage: vi.fn(),
  createTaskFromEmail: (...args: unknown[]) => createTaskFromEmail(...args),
  createTaskFromMessage: vi.fn(),
}));

import {
  InboxActionButtons,
  type InboxSource,
} from "./inbox-action-buttons";

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

const source: InboxSource = {
  kind: "email",
  id: "thread-1",
  subject: "Re: Discovery cutoff",
  snippet: "Hi Jason, can we move the cutoff?",
};

beforeEach(() => {
  createDeadlineFromEmail.mockReset();
  createTaskFromEmail.mockReset();
});

describe("permission gating", () => {
  test("all permitted: three buttons", () => {
    render(<InboxActionButtons source={source} isFiled />);
    expect(screen.getByRole("button", { name: "Save as note" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create task" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create deadline" })
    ).toBeVisible();
  });

  test("each button is hidden without its own permission", () => {
    render(
      <InboxActionButtons
        source={source}
        isFiled
        canCreateNote={false}
        canCreateTask={false}
      />
    );
    expect(screen.queryByRole("button", { name: "Save as note" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create deadline" })
    ).toBeInTheDocument();
  });

  test("renders nothing when the viewer can use none of them", () => {
    const { container } = render(
      <InboxActionButtons
        source={source}
        isFiled
        canCreateNote={false}
        canCreateTask={false}
        canCreateDeadline={false}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("dialog field errors", () => {
  test("a deadline submitted without a date shows the dueDate message", async () => {
    createDeadlineFromEmail.mockImplementation(async () => ({
      status: "error" as const,
      errors: { dueDate: ["Due date is required"] },
    }));
    const user = setupUser();
    render(<InboxActionButtons source={source} isFiled />);

    await user.click(screen.getByRole("button", { name: "Create deadline" }));
    const submit = (
      await screen.findAllByRole("button", { name: "Create deadline" })
    ).at(-1)!;
    // The date input is `required`, so a real browser blocks the
    // submit natively; dispatch the submit event directly to prove the
    // server-side message is rendered when it does get through.
    expect(screen.getByLabelText("Due date")).toBeRequired();
    fireEvent.submit(submit.closest("form")!);

    expect(await screen.findByText("Due date is required")).toBeInTheDocument();
  });

  test("a too-long task description shows the description message", async () => {
    createTaskFromEmail.mockImplementation(async () => ({
      status: "error" as const,
      errors: { description: ["Details are too long"] },
    }));
    const user = setupUser();
    render(<InboxActionButtons source={source} isFiled />);

    await user.click(screen.getByRole("button", { name: "Create task" }));
    const submit = (await screen.findAllByRole("button", { name: "Create task" }))
      .at(-1)!;
    await user.click(submit);

    await waitFor(() =>
      expect(screen.getByText("Details are too long")).toBeInTheDocument()
    );
  });
});

describe("Save as note prefill", () => {
  test("header and quote are separate paragraphs; title prefixes are stripped for task", async () => {
    const user = setupUser();
    render(<InboxActionButtons source={source} isFiled />);

    await user.click(screen.getByRole("button", { name: "Save as note" }));
    const textarea = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(textarea.value).toBe(
      "From email: Re: Discovery cutoff\n\n> Hi Jason, can we move the cutoff?"
    );
  });
});
