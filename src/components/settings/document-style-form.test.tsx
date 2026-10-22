import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const saveDocumentStyle = vi.fn();
vi.mock("@/app/actions/document-style", () => ({
  saveDocumentStyle: (...a: unknown[]) => saveDocumentStyle(...a),
}));

import { DocumentStyleForm } from "./document-style-form";
import { DEFAULT_DOCUMENT_STYLE } from "@/lib/templates/page-style";
import type { ResolvedDoc } from "@/lib/templates/render";

const para = (text: string): ResolvedDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const BLOCKS = [
  { id: "lh", name: "Letterhead", isActive: true },
  { id: "old", name: "Old letterhead", isActive: false },
  { id: "cont", name: "Continuation", isActive: true },
];

const baseProps = {
  initial: { ...DEFAULT_DOCUMENT_STYLE, letterheadBlockId: "lh", continuationBlockId: "cont" },
  updatedAt: "2026-10-22T10:00:00.000Z",
  hasLogo: false,
  blocks: BLOCKS,
  body: para("Sample body"),
  blockDocs: { lh: para("LETTERHEAD TEXT"), cont: para("CONTINUATION TEXT") },
  canEdit: true,
};

beforeEach(() => {
  saveDocumentStyle.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pageStyleAttr = () => document.querySelector("[data-page]")!.getAttribute("style") ?? "";

describe("DocumentStyleForm", () => {
  test("save sends the form values and expectedUpdatedAt, then adopts the new timestamp", async () => {
    saveDocumentStyle.mockResolvedValue({ ok: true, updatedAt: "2026-10-22T11:00:00.000Z" });
    render(<DocumentStyleForm {...baseProps} />);
    fireEvent.change(screen.getByLabelText("Top margin (in)"), { target: { value: "1.25" } });
    fireEvent.change(screen.getByLabelText("Line spacing"), { target: { value: "double" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveDocumentStyle).toHaveBeenCalledTimes(1));
    expect(saveDocumentStyle).toHaveBeenCalledWith({
      ...baseProps.initial,
      marginTopIn: 1.25,
      lineSpacing: "double",
      expectedUpdatedAt: "2026-10-22T10:00:00.000Z",
    });
    await screen.findByText("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveDocumentStyle).toHaveBeenCalledTimes(2));
    expect(saveDocumentStyle.mock.calls[1][0].expectedUpdatedAt).toBe("2026-10-22T11:00:00.000Z");
  });

  test("Garamond shows the line-break note; other fonts do not", () => {
    render(<DocumentStyleForm {...baseProps} />);
    const note = "Line breaks may differ slightly between Word and PDF.";
    expect(screen.queryByText(note)).toBeNull();
    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "garamond" } });
    expect(screen.getByText(note)).toBeTruthy();
  });

  test("preview follows the font selection", () => {
    render(<DocumentStyleForm {...baseProps} />);
    expect(pageStyleAttr()).toContain("Tpl Liberation Serif");
    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "garamond" } });
    expect(pageStyleAttr()).toContain("Tpl EB Garamond");
    expect(screen.getByText("LETTERHEAD TEXT")).toBeTruthy();
  });

  test("font options render in their own face", () => {
    render(<DocumentStyleForm {...baseProps} />);
    const opt = screen.getByRole("option", { name: "Garamond" }) as HTMLOptionElement;
    expect(opt.style.fontFamily).toContain("Tpl EB Garamond");
  });

  test("read-only: inputs disabled, no save or upload, preview still shown", () => {
    render(<DocumentStyleForm {...baseProps} canEdit={false} hasLogo />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByLabelText("Upload logo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull();
    expect((screen.getByLabelText("Font") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Top margin (in)") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("page-preview")).toBeTruthy();
  });

  test("stale save shows the error with a Reload action", async () => {
    saveDocumentStyle.mockResolvedValue({
      ok: false,
      error: "Someone else saved the document style — reload to see their changes.",
    });
    render(<DocumentStyleForm {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Someone else saved the document style/);
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  test("archived selected block is listed and labelled; None is offered", () => {
    render(
      <DocumentStyleForm
        {...baseProps}
        initial={{ ...baseProps.initial, letterheadBlockId: "old" }}
        blockDocs={{ ...baseProps.blockDocs, old: para("OLD") }}
      />,
    );
    expect(screen.getByRole("option", { name: "Old letterhead (archived)" })).toBeTruthy();
    expect(screen.getAllByRole("option", { name: "None" }).length).toBeGreaterThanOrEqual(2);
  });

  test("page numbers explain letters vs filings", () => {
    render(<DocumentStyleForm {...baseProps} />);
    expect(
      screen.getByText(
        "Letters show the page number in the later-page header. The bottom center / bottom right choice applies to filings.",
      ),
    ).toBeTruthy();
  });

  test("logo upload adopts updatedAt and logoPosition, bumps the preview URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        updatedAt: "2026-10-22T12:00:00.000Z",
        logoPosition: "left",
        logoPositionChanged: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    saveDocumentStyle.mockResolvedValue({ ok: true, updatedAt: "2026-10-22T13:00:00.000Z" });
    render(<DocumentStyleForm {...baseProps} />);
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", {
      type: "image/png",
    });
    fireEvent.change(screen.getByLabelText("Upload logo"), { target: { files: [file] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/document-style/logo");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("expectedUpdatedAt")).toBe("2026-10-22T10:00:00.000Z");
    await waitFor(() =>
      expect(document.querySelector("img")?.getAttribute("src")).toBe(
        "/api/document-style/logo?v=2026-10-22T12%3A00%3A00.000Z",
      ),
    );
    expect((screen.getByLabelText("Logo position") as HTMLSelectElement).value).toBe("left");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveDocumentStyle).toHaveBeenCalled());
    const sent = saveDocumentStyle.mock.calls[0][0];
    expect(sent.expectedUpdatedAt).toBe("2026-10-22T12:00:00.000Z");
    expect(sent.logoPosition).toBe("left");
  });

  test("logo upload error text shows inline; 409 offers Reload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          ok: false,
          error: "Someone else saved the document style — reload to see their changes.",
        }),
      }),
    );
    render(<DocumentStyleForm {...baseProps} />);
    const file = new File([new Uint8Array([1])], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload logo"), { target: { files: [file] } });
    await screen.findByText(/Someone else saved the document style/);
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    // Not adopted: the preview URL keeps the loaded version.
    expect(document.querySelector("img")).toBeNull();
  });

  test("upload keeps an unsaved position edit when the server didn't change it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        updatedAt: "2026-10-22T12:00:00.000Z",
        logoPosition: "left",
        logoPositionChanged: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DocumentStyleForm
        {...baseProps}
        hasLogo
        initial={{ ...baseProps.initial, logoPosition: "left" }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Logo position"), { target: { value: "right" } });
    const file = new File([new Uint8Array([1])], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload logo"), { target: { files: [file] } });
    await waitFor(() =>
      expect(document.querySelector("img")?.getAttribute("src")).toBe(
        "/api/document-style/logo?v=2026-10-22T12%3A00%3A00.000Z",
      ),
    );
    expect((screen.getByLabelText("Logo position") as HTMLSelectElement).value).toBe("right");
  });

  test("remove logo calls DELETE and adopts the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, updatedAt: "2026-10-22T14:00:00.000Z", logoPosition: "left" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DocumentStyleForm
        {...baseProps}
        hasLogo
        initial={{ ...baseProps.initial, logoPosition: "left" }}
      />,
    );
    expect(document.querySelector("img")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    await waitFor(() => expect(fetchMock.mock.calls[0][1].method).toBe("DELETE"));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/document-style/logo?expectedUpdatedAt=2026-10-22T10%3A00%3A00.000Z",
    );
    await waitFor(() => expect(document.querySelector("img")).toBeNull());
  });

  test("changing line spacing updates the live preview", () => {
    render(<DocumentStyleForm {...baseProps} />);
    const before = pageStyleAttr();
    fireEvent.change(screen.getByLabelText("Line spacing"), { target: { value: "double" } });
    const after = pageStyleAttr();
    expect(after).not.toBe(before);
    expect(after).toContain(String(2 * 1.15));
  });
});
