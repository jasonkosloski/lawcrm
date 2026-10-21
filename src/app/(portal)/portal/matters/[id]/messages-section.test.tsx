import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const send = vi.fn();
const markRead = vi.fn();
const refresh = vi.fn();
vi.mock("@/app/actions/portal-messages-client", () => ({
  sendPortalMessage: (...a: unknown[]) => send(...a),
  markPortalMessagesRead: (...a: unknown[]) => markRead(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { MessagesSection } from "./messages-section";

const msg = (over: Record<string, unknown>) => ({
  id: "m1",
  body: "Hello",
  createdAt: new Date("2026-11-03T16:00:00Z"), // 9:00 AM MST
  fromClient: true,
  authorLabel: "You",
  ...over,
});

const base = {
  matterId: "mat1",
  closed: false,
  firmPhone: null,
  firmEmail: null,
};

beforeEach(() => {
  send.mockReset();
  markRead.mockReset();
  refresh.mockReset();
});

describe("MessagesSection", () => {
  test("conversation is shown in order with author labels and Denver times", () => {
    render(
      <MessagesSection
        {...base}
        messages={[
          msg({ id: "a", body: "First question" }),
          msg({
            id: "b",
            body: "Our answer",
            fromClient: false,
            authorLabel: "Sam Lee (your legal team)",
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("First question");
    expect(items[1].textContent).toContain("Our answer");
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Sam Lee (your legal team)")).toBeTruthy();
    expect(screen.getAllByText(/9:00 AM/).length).toBe(2);
  });

  test("text is literal and keeps line breaks", () => {
    render(
      <MessagesSection
        {...base}
        messages={[msg({ body: "<b>x</b>\nsecond line" })]}
      />,
    );
    const el = screen.getByText(/<b>x<\/b>/);
    expect(el.className).toContain("whitespace-pre-line");
    expect(el.querySelector("b")).toBeNull();
  });

  test("empty state, with the composer", () => {
    render(<MessagesSection {...base} messages={[]} />);
    expect(
      screen.getByText("No messages yet. Ask your legal team a question here."),
    ).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(markRead).not.toHaveBeenCalled();
  });

  test("closed matter shows contact copy and no composer", () => {
    render(
      <MessagesSection
        {...base}
        closed
        firmPhone="555-0100"
        firmEmail="a@firm.test"
        messages={[msg({})]}
      />,
    );
    expect(
      screen.getByText(
        "This matter is closed. Contact the firm at 555-0100 or a@firm.test.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("closed copy with one or no contact detail", () => {
    const { unmount } = render(
      <MessagesSection {...base} closed firmEmail="a@firm.test" messages={[]} />,
    );
    expect(
      screen.getByText("This matter is closed. Contact the firm at a@firm.test."),
    ).toBeTruthy();
    unmount();
    render(<MessagesSection {...base} closed messages={[]} />);
    expect(screen.getByText("This matter is closed.")).toBeTruthy();
  });

  test("marks read once on view when there are messages", () => {
    const { rerender } = render(
      <MessagesSection {...base} messages={[msg({})]} />,
    );
    rerender(
      <MessagesSection {...base} messages={[msg({}), msg({ id: "m2" })]} />,
    );
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith("mat1");
  });

  test("Send is disabled until there is text; ok clears the draft and refreshes", async () => {
    send.mockResolvedValue({ ok: true });
    render(<MessagesSection {...base} messages={[]} />);
    const btn = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(5000);
    fireEvent.change(box, { target: { value: "Question?" } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith("mat1", "Question?");
    expect(box.value).toBe("");
  });

  test("a thrown send keeps the draft and shows a retry message", async () => {
    send.mockRejectedValue(new Error("network"));
    render(<MessagesSection {...base} messages={[]} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Question?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Couldn't send. Please try again.");
    expect(box.value).toBe("Question?");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("error keeps the draft and is announced", async () => {
    send.mockResolvedValue({
      ok: false,
      error: "You're sending messages too quickly. Try again later.",
    });
    render(<MessagesSection {...base} messages={[]} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "You're sending messages too quickly. Try again later.",
    );
    expect(box.value).toBe("Again");
    expect(refresh).not.toHaveBeenCalled();
  });
});
