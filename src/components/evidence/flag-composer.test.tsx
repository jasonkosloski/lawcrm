/**
 * FlagComposer / MomentsRail behavior tests (F399, F1001, F1002,
 * F1003, F1004). Server actions are mocked; these pin the client
 * contract: re-capture re-seeds the quote, thrown actions become
 * inline errors, no router.refresh, unique ids, delete confirms.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createFlaggedMoment = vi.fn();
const updateFlaggedMoment = vi.fn();
const deleteFlaggedMoment = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/actions/flagged-moments", () => ({
  createFlaggedMoment: (...a: unknown[]) => createFlaggedMoment(...a),
  updateFlaggedMoment: (...a: unknown[]) => updateFlaggedMoment(...a),
  deleteFlaggedMoment: (...a: unknown[]) => deleteFlaggedMoment(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  unstable_rethrow: vi.fn(),
}));

import { FlagComposer, type ComposerAnchor } from "./flag-composer";
import { MomentsRail, type RailMoment } from "./moments-rail";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const quoteAnchor = (quote: string): ComposerAnchor => ({
  kind: "quote",
  quote,
});

describe("FlagComposer — re-capture while open (F399)", () => {
  test("a new quote capture replaces the quote text and keeps the typed note", () => {
    const { rerender } = render(
      <FlagComposer
        documentId="d1"
        editing={null}
        createAnchor={quoteAnchor("passage A")}
        onClose={() => {}}
      />
    );
    const note = screen.getByLabelText("Note") as HTMLTextAreaElement;
    expect(
      (screen.getByLabelText("Quoted text") as HTMLTextAreaElement).value
    ).toBe("passage A");
    // Typed note survives the re-capture.
    note.focus();
    rerender(
      <FlagComposer
        documentId="d1"
        editing={null}
        createAnchor={quoteAnchor("passage B")}
        onClose={() => {}}
      />
    );
    expect(
      (screen.getByLabelText("Quoted text") as HTMLTextAreaElement).value
    ).toBe("passage B");
  });

  test("switching from a whole-document capture to a selection seeds the quote", () => {
    const { rerender } = render(
      <FlagComposer
        documentId="d1"
        editing={null}
        createAnchor={{ kind: "document" }}
        onClose={() => {}}
      />
    );
    expect(screen.queryByLabelText("Quoted text")).toBeNull();
    rerender(
      <FlagComposer
        documentId="d1"
        editing={null}
        createAnchor={quoteAnchor("selected text")}
        onClose={() => {}}
      />
    );
    expect(
      (screen.getByLabelText("Quoted text") as HTMLTextAreaElement).value
    ).toBe("selected text");
  });

  test("a hint from the capture is announced", () => {
    render(
      <FlagComposer
        documentId="d1"
        editing={null}
        createAnchor={{ kind: "quote", quote: "x", hint: "appears 3 times" }}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("appears 3 times");
  });
});

describe("FlagComposer — submit", () => {
  test("success closes without router.refresh (F1002)", async () => {
    createFlaggedMoment.mockResolvedValue({ ok: true, id: "f1" });
    const onClose = vi.fn();
    render(
      <FlagComposer
        documentId="d1"
        editing={null}
        createAnchor={{ kind: "document" }}
        onClose={onClose}
      />
    );
    await userEvent.type(screen.getByLabelText("Note"), "important");
    await userEvent.click(screen.getByRole("button", { name: "Add flag" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createFlaggedMoment).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ description: "important" })
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a rejected action shows an inline error and keeps the note (F1001)", async () => {
    createFlaggedMoment.mockRejectedValue(new Error("Failed to fetch"));
    const onClose = vi.fn();
    render(
      <FlagComposer
        documentId="d1"
        editing={null}
        createAnchor={{ kind: "document" }}
        onClose={onClose}
      />
    );
    await userEvent.type(screen.getByLabelText("Note"), "keep me");
    await userEvent.click(screen.getByRole("button", { name: "Add flag" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't save/i
    );
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe(
      "keep me"
    );
  });

  test("a 'Flag not found' result is shown inline", async () => {
    updateFlaggedMoment.mockResolvedValue({ ok: false, error: "Flag not found" });
    render(
      <FlagComposer
        documentId="d1"
        editing={{
          id: "f1",
          timeSeconds: null,
          endSeconds: null,
          pageNumber: null,
          quote: null,
          category: "emphasis",
          description: "old",
        }}
        createAnchor={null}
        onClose={() => {}}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save changes" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Flag not found");
    // Nothing was revalidated server-side — the client re-reads.
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("FlagComposer — accessibility (F1003)", () => {
  test("two composers on one document do not share ids and every control is labelled", () => {
    render(
      <>
        <FlagComposer
          documentId="d1"
          editing={null}
          createAnchor={{ kind: "time", timeSeconds: 5 }}
          onClose={() => {}}
        />
        <FlagComposer
          documentId="d1"
          editing={null}
          createAnchor={{ kind: "time", timeSeconds: 9 }}
          onClose={() => {}}
        />
      </>
    );
    const ids = Array.from(document.querySelectorAll("[id]")).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Labels resolve to inputs (both composers' fields).
    expect(screen.getAllByLabelText("Time")).toHaveLength(2);
    expect(screen.getAllByLabelText("Span end (optional)")).toHaveLength(2);
    expect(screen.getAllByLabelText("Category")).toHaveLength(2);
    expect(screen.getAllByLabelText("Note")).toHaveLength(2);
  });
});

describe("MomentsRail — delete", () => {
  const moment: RailMoment = {
    id: "f1",
    timeSeconds: null,
    endSeconds: null,
    pageNumber: null,
    quote: null,
    category: "emphasis",
    description: "note",
    flaggedById: "u1",
    flaggedByInitials: "AA",
    flaggedByName: "Ann Attorney",
  };

  const openDelete = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Flag actions" }));
    await userEvent.click(await screen.findByText("Delete"));
  };

  test("declining the confirm deletes nothing", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(
      <MomentsRail
        documentId="d1"
        moments={[moment]}
        currentUserId="u1"
        canEditAny={false}
        canDeleteAny={false}
        emptyHint=""
      />
    );
    await openDelete();
    expect(deleteFlaggedMoment).not.toHaveBeenCalled();
  });

  test("confirming deletes, without router.refresh", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    deleteFlaggedMoment.mockResolvedValue({ ok: true });
    render(
      <MomentsRail
        documentId="d1"
        moments={[moment]}
        currentUserId="u1"
        canEditAny={false}
        canDeleteAny={false}
        emptyHint=""
      />
    );
    await openDelete();
    await waitFor(() => expect(deleteFlaggedMoment).toHaveBeenCalledWith("f1"));
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a failed delete surfaces the error instead of an error page", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    deleteFlaggedMoment.mockResolvedValue({ ok: false, error: "Flag not found" });
    render(
      <MomentsRail
        documentId="d1"
        moments={[moment]}
        currentUserId="u1"
        canEditAny={false}
        canDeleteAny={false}
        emptyHint=""
      />
    );
    await openDelete();
    expect(await screen.findByRole("alert")).toHaveTextContent("Flag not found");
  });

  test("a rejected delete shows a connection error", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    deleteFlaggedMoment.mockRejectedValue(new Error("network"));
    render(
      <MomentsRail
        documentId="d1"
        moments={[moment]}
        currentUserId="u1"
        canEditAny={false}
        canDeleteAny={false}
        emptyHint=""
      />
    );
    await openDelete();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't delete/i);
  });
});
