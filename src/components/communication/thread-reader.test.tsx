/**
 * ThreadReader wiring tests:
 *   - "Save as note" is seeded with the first message as TEXT: Gmail-
 *     synced / CRM-sent bodies are sanitized HTML, and quoting them raw
 *     put visible markup (cut mid-tag at 400 chars) into the note.
 *   - Action affordances follow the viewer's permissions (the actions
 *     redirect to the dashboard on denial, losing typed input).
 *
 * Child client components are mocked to marker elements exposing the
 * props the reader passes down.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("@/app/actions/follow-ups", () => ({
  setEmailThreadFollowUp: vi.fn(),
}));
vi.mock("./inbox-action-buttons", () => ({
  InboxActionButtons: (props: {
    source: { snippet: string };
    canCreateTask: boolean;
    canCreateNote: boolean;
    canCreateDeadline: boolean;
  }) => (
    <span
      data-testid="inbox-actions"
      data-snippet={props.source.snippet}
      data-task={String(props.canCreateTask)}
      data-note={String(props.canCreateNote)}
      data-deadline={String(props.canCreateDeadline)}
    />
  ),
}));
vi.mock("./file-to-matter-picker", () => ({
  FileToMatterPicker: ({ canFile }: { canFile: boolean }) => (
    <span data-testid="file-picker" data-can-file={String(canFile)} />
  ),
}));
vi.mock("./log-time-on-comm-button", () => ({
  LogTimeOnCommButton: () => <span data-testid="log-time-btn" />,
}));
vi.mock("./follow-up-button", () => ({ FollowUpButton: () => null }));
vi.mock("./comm-time-logged-indicator", () => ({
  CommTimeLoggedIndicator: () => null,
}));
vi.mock("./attachment-chips", () => ({ AttachmentChips: () => null }));
vi.mock("./back-to-list-button", () => ({ BackToListButton: () => null }));
vi.mock("./mark-thread-read", () => ({ MarkThreadRead: () => null }));
vi.mock("./reply-section", () => ({ ReplySection: () => null }));

import { currentUserHasPermission } from "@/lib/permission-check";
import type { ThreadDetail } from "@/lib/queries/communication";
import { ThreadReader } from "./thread-reader";

function thread(body: string): ThreadDetail {
  return {
    id: "thread-1",
    subject: "Discovery",
    matter: null,
    labels: [],
    messageCount: 1,
    lastMessageAt: new Date("2026-07-01T10:00:00Z"),
    followUpAt: null,
    messages: [
      {
        id: "m1",
        fromName: "Alice",
        fromEmail: "alice@example.com",
        toRecipients: [{ email: "me@firm.test" }],
        ccRecipients: [],
        sentAt: new Date("2026-07-01T10:00:00Z"),
        body,
        isPrivileged: false,
        timeEntries: [],
        attachments: [],
      },
    ],
  } as unknown as ThreadDetail;
}

async function renderReader(t: ThreadDetail) {
  return render(await ThreadReader({ thread: t, filingOptions: [] }));
}

beforeEach(() => {
  vi.mocked(currentUserHasPermission).mockReset();
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
});

describe("note snippet", () => {
  test("an HTML body is quoted as plain text, not markup", async () => {
    await renderReader(
      thread(
        '<div dir="ltr">Hi Jason,<br><br>Attached is the <b>signed</b> response.</div>'
      )
    );
    const snippet = screen.getByTestId("inbox-actions").dataset.snippet!;
    expect(snippet).toBe("Hi Jason,\n\nAttached is the signed response.");
    expect(snippet).not.toContain("<");
  });

  test("conversion happens before truncation (no half-cut tags)", async () => {
    const long = `<p>${"word ".repeat(200)}</p>`;
    await renderReader(thread(long));
    const snippet = screen.getByTestId("inbox-actions").dataset.snippet!;
    expect(snippet.length).toBeLessThanOrEqual(400);
    expect(snippet).not.toMatch(/[<>]/);
  });

  test("a legacy plain-text body is passed through", async () => {
    await renderReader(thread("Plain text body"));
    expect(screen.getByTestId("inbox-actions").dataset.snippet).toBe(
      "Plain text body"
    );
  });
});

describe("note snippet (plain text)", () => {
  test("a plain-text body keeps its paragraph break and line breaks", async () => {
    await renderReader(
      thread("Hi Jason,\r\n\r\n\r\n\r\nSee   attached.\nThanks")
    );
    expect(screen.getByTestId("inbox-actions").dataset.snippet).toBe(
      "Hi Jason,\n\nSee attached.\nThanks"
    );
  });
});

describe("permission-gated affordances", () => {
  test("a viewer without the keys gets no log-time button, flagged inbox actions and a read-only picker", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key === "documents.upload"
    );
    await renderReader(thread("hi"));

    expect(screen.queryByTestId("log-time-btn")).toBeNull();
    const actions = screen.getByTestId("inbox-actions");
    expect(actions).toHaveAttribute("data-task", "false");
    expect(actions).toHaveAttribute("data-note", "false");
    expect(actions).toHaveAttribute("data-deadline", "false");
    expect(screen.getByTestId("file-picker")).toHaveAttribute(
      "data-can-file",
      "false"
    );
  });

  test("a viewer with the keys sees everything", async () => {
    await renderReader(thread("hi"));
    expect(screen.getByTestId("log-time-btn")).toBeInTheDocument();
    expect(screen.getByTestId("file-picker")).toHaveAttribute(
      "data-can-file",
      "true"
    );
    expect(screen.getByTestId("inbox-actions")).toHaveAttribute(
      "data-task",
      "true"
    );
  });
});
