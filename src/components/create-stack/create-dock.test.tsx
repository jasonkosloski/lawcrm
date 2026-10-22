/**
 * Tests for CreateDock + CreateStackProvider.
 *
 * Draft preservation (regressions):
 *   - expand / collapse used to move the panel into a different JSX
 *     branch, unmounting it and wiping the draft
 *   - bodies were rendered without a key inside one shared slot, so two
 *     same-type panels shared ONE form instance (cross-panel leakage)
 *     and switching to another type destroyed the draft
 *   - NewEventComposer's close-on-ok effect depends on onClose; a fresh
 *     onClose per render cascaded closes through every event panel
 *
 * Keyboard / a11y:
 *   - Escape was a window listener: it closed the docked panel (and its
 *     draft) for ANY Escape, including ones aimed at other widgets
 *   - the expanded modal had no dialog semantics, focus move or trap
 *
 * Stack behavior: focus, chip switching, close, expansion hand-off.
 *
 * The real bodies (Tiptap, server actions) are replaced by stateful
 * stubs — the contract under test is mounting, not form behavior. The
 * dock lazy-loads them (next/dynamic), so tests await their arrival.
 */

import { useEffect } from "react";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mounts = vi.hoisted(() => ({ composerCloses: 0 }));

// Anchor stand-in; preventDefault keeps the test document in place.
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: React.ComponentProps<"a"> & { href: string }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/matters/notes/note-panel-body", () => ({
  NotePanelBody: ({ panelId }: { panelId: string }) => (
    <textarea aria-label={`note-${panelId}`} data-testid="note" />
  ),
}));
vi.mock("@/components/calendar/new-event-composer", () => ({
  NewEventComposer: ({ panelId, onClose }: { panelId: string; onClose?: () => void }) => {
    // Mirrors the real composer: "saved" => close via the effect, which
    // depends on onClose.
    useEffect(() => {
      if (panelId.length > 0) {
        mounts.composerCloses++;
        onClose?.();
      }
    }, [panelId, onClose]);
    return <input aria-label={`event-${panelId}`} data-testid="event" />;
  },
}));

import { CreateDock } from "./create-dock";
import { CreateStackProvider, useCreateStack } from "./create-stack-provider";

function Harness({ matterId }: { matterId: string | null }) {
  return (
    <CreateStackProvider context={{ matterId, color: "#000", label: "Matter", sublabel: null }}>
      <Openers />
      <CreateDock />
    </CreateStackProvider>
  );
}

function Openers() {
  const { open, panels } = useCreateStack();
  return (
    <>
      <button onClick={() => open("note")}>open-note</button>
      <button onClick={() => open("task")}>open-task</button>
      <span data-testid="panel-count">{panels.length}</span>
    </>
  );
}

const textareas = () => screen.queryAllByTestId("note") as HTMLTextAreaElement[];
const notVisible = (t: HTMLElement) => t.closest(".hidden") !== null;
/** The visible (focused) body's textarea — waits for the lazy body. */
const visibleNote = async (): Promise<HTMLTextAreaElement> => {
  await waitFor(() => expect(textareas().some((t) => !notVisible(t))).toBe(true));
  return textareas().find((t) => !notVisible(t)) as HTMLTextAreaElement;
};
const panelCount = () => Number(screen.getByTestId("panel-count").textContent);

describe("CreateDock drafts", () => {
  test("expand and collapse keep the draft", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.type(await visibleNote(), "long note in progress");

    await user.click(screen.getByRole("button", { name: /expand to modal/i }));
    expect((await visibleNote()).value).toBe("long note in progress");

    await user.click(screen.getAllByRole("button", { name: /collapse to sidebar/i })[0]);
    expect((await visibleNote()).value).toBe("long note in progress");
  });

  test("two note panels never share a form instance", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.type(await visibleNote(), "note A");
    await user.click(screen.getByText("open-note"));

    // Two live bodies; the new (focused) one is empty and A's draft
    // is intact in the hidden one.
    await waitFor(() => expect(textareas()).toHaveLength(2));
    expect((await visibleNote()).value).toBe("");
    expect(
      textareas()
        .map((t) => t.value)
        .sort(),
    ).toEqual(["", "note A"]);
  });

  test("switching to another panel type and back keeps the note draft", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.type(await visibleNote(), "keep me");
    await user.click(screen.getByText("open-task"));
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect((await visibleNote()).value).toBe("keep me");
  });

  test("a finished event panel closes itself exactly once (no re-fired close per stack change)", async () => {
    mounts.composerCloses = 0;
    const user = userEvent.setup();
    function EventOpeners() {
      const { open } = useCreateStack();
      return <button onClick={() => open("event")}>open-event</button>;
    }
    render(
      <CreateStackProvider context={{ matterId: null, color: "#000", label: "", sublabel: null }}>
        <EventOpeners />
        <CreateDock />
      </CreateStackProvider>,
    );
    // The stub fires its close-on-ok effect on mount, like a saved
    // composer. Each open/close changes the stack (new `close`
    // identity); the per-panel onClose must stay stable so no effect
    // re-fires and chews through other panels.
    await user.click(screen.getByText("open-event"));
    await user.click(screen.getByText("open-event"));
    await user.click(screen.getByText("open-event"));
    await waitFor(() => expect(mounts.composerCloses).toBe(3));
    // Settle: nothing re-fires after the stack changes.
    await new Promise((r) => setTimeout(r, 20));
    expect(mounts.composerCloses).toBe(3);
  });
});

describe("CreateDock keyboard", () => {
  test("focus moves into the panel when it opens", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-task"));
    const aside = screen.getByRole("complementary", { name: /create panel/i });
    await waitFor(() => expect(aside.contains(document.activeElement)).toBe(true));
  });

  test("Escape closes a docked panel that has nothing typed in it", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-task"));
    expect(panelCount()).toBe(1);

    await user.keyboard("{Escape}");
    expect(panelCount()).toBe(0);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  test("Escape does NOT discard a docked panel that holds a draft", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.type(await visibleNote(), "precious words");

    await user.keyboard("{Escape}");
    expect(panelCount()).toBe(1);
    expect((await visibleNote()).value).toBe("precious words");
  });

  test("an Escape made outside the panel (e.g. closing another widget) leaves it alone", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-task"));

    // Focus is on a control outside the dock, like the bell trigger.
    screen.getByText("open-note").focus();
    await user.keyboard("{Escape}");
    expect(panelCount()).toBe(1);
  });

  test("an Escape that is part of an IME composition is ignored", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-task"));

    fireEvent.keyDown(screen.getByRole("complementary"), {
      key: "Escape",
      isComposing: true,
    });
    expect(panelCount()).toBe(1);
  });

  test("Escape in the expanded modal collapses it and keeps the draft", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.type(await visibleNote(), "draft");
    await user.click(screen.getByRole("button", { name: /expand to modal/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(panelCount()).toBe(1);
    expect((await visibleNote()).value).toBe("draft");
  });
});

describe("CreateDock accessibility", () => {
  test("only the expanded panel is a modal dialog", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-task"));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: /expand to modal/i }));
    const dialog = screen.getByRole("dialog", { name: /expanded/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  test("Tab wraps inside the expanded modal (focus can't reach the page behind)", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-task"));
    await user.click(screen.getByRole("button", { name: /expand to modal/i }));
    const dialog = screen.getByRole("dialog");

    // The last focusable control in the modal is the footer link.
    const link = screen.getByRole("link", { name: /go to tasks/i });
    link.focus();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(link);

    // And Shift+Tab from the first control wraps to the last.
    const first = dialog.querySelector<HTMLElement>("button")!;
    first.focus();
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  test("the docked rail goes full-screen below sm instead of overflowing", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-task"));
    const cls = screen.getByRole("complementary").className;
    expect(cls).toContain("sm:w-96");
    expect(cls).toContain("max-sm:fixed");
    expect(cls).not.toMatch(/(^|\s)w-96(\s|$)/);
  });
});

describe("CreateDock — types without a dock form", () => {
  test("point at the matter tab with the working form instead of a disabled Save", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-task"));

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    const link = screen.getByRole("link", { name: /go to tasks/i });
    expect(link).toHaveAttribute("href", "/matters/m1/tasks");

    await user.click(link);
    expect(panelCount()).toBe(0);
  });

  test("without a matter there is no link, just Cancel", async () => {
    const user = userEvent.setup();
    render(<Harness matterId={null} />);
    await user.click(screen.getByText("open-task"));
    expect(screen.queryByRole("link", { name: /go to/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(panelCount()).toBe(0);
  });
});

describe("CreateStackProvider", () => {
  test("chips switch focus; closing the focused panel falls back to the last remaining", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.click(screen.getByText("open-task"));
    expect(panelCount()).toBe(2);
    // Task is focused; Note is a chip.
    expect(screen.getByRole("heading", { name: "Add task" })).toBeInTheDocument();

    await user.click(screen.getByTitle("Switch to Add note"));
    expect(screen.getByRole("heading", { name: "Add note" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(panelCount()).toBe(1);
    expect(screen.getByRole("heading", { name: "Add task" })).toBeInTheDocument();
  });

  test("closing an expanded focused panel hands the expansion to the next one", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.click(screen.getByText("open-task"));
    await user.click(screen.getByRole("button", { name: /expand to modal/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    // The remaining panel stays in focus mode, not kicked to the rail.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(panelCount()).toBe(1);
  });

  test("useCreateStack outside the provider fails loudly", () => {
    function Bad() {
      useCreateStack();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow(/CreateStackProvider/);
    spy.mockRestore();
  });
});
