import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const saveDocumentStyle = vi.fn();
const saveParagraphStyles = vi.fn();
vi.mock("@/app/actions/document-style", () => ({
  saveDocumentStyle: (...a: unknown[]) => saveDocumentStyle(...a),
  saveParagraphStyles: (...a: unknown[]) => saveParagraphStyles(...a),
}));

import { DocumentSettings } from "./document-settings";
import { DEFAULT_DOCUMENT_STYLE } from "@/lib/templates/page-style";

beforeEach(() => {
  saveDocumentStyle.mockReset();
  saveParagraphStyles.mockReset();
});
afterEach(cleanup);

describe("DocumentSettings", () => {
  test("saving one form hands its new token to the other", async () => {
    saveDocumentStyle.mockResolvedValue({ ok: true, updatedAt: "T2" });
    saveParagraphStyles.mockResolvedValue({ ok: true, updatedAt: "T3" });
    render(
      <DocumentSettings
        updatedAt="T1"
        houseStyle={{
          initial: DEFAULT_DOCUMENT_STYLE,
          hasLogo: false,
          blocks: [],
          body: { type: "doc", content: [] },
          blockDocs: {},
          canEdit: true,
        }}
        paragraphStyles={{
          initial: DEFAULT_DOCUMENT_STYLE.paragraphStyles,
          fontKey: "times",
          canEdit: true,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveDocumentStyle).toHaveBeenCalledTimes(1));
    expect(saveDocumentStyle.mock.calls[0][0].expectedUpdatedAt).toBe("T1");
    await screen.findByText("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Save styles" }));
    await waitFor(() => expect(saveParagraphStyles).toHaveBeenCalledTimes(1));
    expect(saveParagraphStyles.mock.calls[0][0].expectedUpdatedAt).toBe("T2");
    await waitFor(() => expect(screen.getAllByText("Saved").length).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveDocumentStyle).toHaveBeenCalledTimes(2));
    expect(saveDocumentStyle.mock.calls[1][0].expectedUpdatedAt).toBe("T3");
  });
});
