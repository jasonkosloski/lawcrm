/**
 * Tests for CreateDock draft preservation.
 *
 * Regressions pinned:
 *   - expand / collapse used to move the panel into a different JSX
 *     branch, unmounting it and wiping the draft
 *   - bodies were rendered without a key inside one shared slot, so two
 *     same-type panels shared ONE form instance (cross-panel leakage)
 *     and switching to another type destroyed the draft
 *   - NewEventComposer's close-on-ok effect depends on onClose; a fresh
 *     onClose per render cascaded closes through every event panel
 *
 * The real bodies (Tiptap, server actions) are replaced by stateful
 * stubs — the contract under test is mounting, not form behavior.
 */

import { useEffect } from "react";
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mounts = vi.hoisted(() => ({ composerCloses: 0 }));

vi.mock("@/components/matters/notes/note-panel-body", () => ({
  NotePanelBody: ({ panelId }: { panelId: string }) => (
    <textarea aria-label={`note-${panelId}`} data-testid="note" />
  ),
}));
vi.mock("@/components/calendar/new-event-composer", () => ({
  NewEventComposer: ({
    panelId,
    onClose,
  }: {
    panelId: string;
    onClose?: () => void;
  }) => {
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
    <CreateStackProvider
      context={{ matterId, color: "#000", label: "Matter", sublabel: null }}
    >
      <Openers />
      <CreateDock />
    </CreateStackProvider>
  );
}

function Openers() {
  const { open } = useCreateStack();
  return (
    <>
      <button onClick={() => open("note")}>open-note</button>
      <button onClick={() => open("task")}>open-task</button>
    </>
  );
}

const textareas = () =>
  screen.queryAllByTestId("note") as HTMLTextAreaElement[];
/** The visible (focused) body's textarea. */
const visibleNote = () =>
  textareas().find((t) => !t.closest(".hidden")) as HTMLTextAreaElement;

describe("CreateDock drafts", () => {
  test("expand and collapse keep the draft", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.type(visibleNote(), "long note in progress");

    await user.click(screen.getByRole("button", { name: /expand to modal/i }));
    expect(visibleNote().value).toBe("long note in progress");

    await user.click(
      screen.getAllByRole("button", { name: /collapse to sidebar/i })[0]
    );
    expect(visibleNote().value).toBe("long note in progress");
  });

  test("two note panels never share a form instance", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.type(visibleNote(), "note A");
    await user.click(screen.getByText("open-note"));

    // Two live bodies; the new (focused) one is empty and A's draft
    // is intact in the hidden one.
    expect(textareas()).toHaveLength(2);
    expect(visibleNote().value).toBe("");
    expect(textareas().map((t) => t.value).sort()).toEqual(["", "note A"]);
  });

  test("switching to another panel type and back keeps the note draft", async () => {
    const user = userEvent.setup();
    render(<Harness matterId="m1" />);
    await user.click(screen.getByText("open-note"));
    await user.type(visibleNote(), "keep me");
    await user.click(screen.getByText("open-task"));
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(visibleNote().value).toBe("keep me");
  });

  test("a finished event panel closes itself exactly once (no re-fired close per stack change)", async () => {
    mounts.composerCloses = 0;
    const user = userEvent.setup();
    function EventOpeners() {
      const { open } = useCreateStack();
      return <button onClick={() => open("event")}>open-event</button>;
    }
    render(
      <CreateStackProvider
        context={{ matterId: null, color: "#000", label: "", sublabel: null }}
      >
        <EventOpeners />
        <CreateDock />
      </CreateStackProvider>
    );
    // The stub fires its close-on-ok effect on mount, like a saved
    // composer. Each open/close changes the stack (new `close`
    // identity); the per-panel onClose must stay stable so no effect
    // re-fires and chews through other panels.
    await user.click(screen.getByText("open-event"));
    await user.click(screen.getByText("open-event"));
    await user.click(screen.getByText("open-event"));
    expect(mounts.composerCloses).toBe(3);
  });
});
