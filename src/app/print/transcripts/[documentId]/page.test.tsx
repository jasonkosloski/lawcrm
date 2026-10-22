import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({ getCurrentUserTimeZone: vi.fn() }));
vi.mock("@/lib/queries/transcript", () => ({
  getDocumentTranscript: vi.fn(),
  getTranscriptCaption: vi.fn(),
}));
vi.mock("@/components/matters/billing/print-toolbar", () => ({
  PrintToolbar: () => null,
}));

import { requireUser } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { getDocumentTranscript, getTranscriptCaption } from "@/lib/queries/transcript";
import PrintTranscriptPage from "./page";

const params = Promise.resolve({ documentId: "doc_1" });
const searchParams = Promise.resolve({});

const view = (over: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    status: "completed",
    error: null,
    durationSeconds: 754,
    completedAt: new Date("2026-10-01T15:00:00Z"),
    correctedAt: null,
    correctedByName: null,
    speakers: { A: "Officer Diaz" },
    segments: [
      { id: "s1", index: 0, speaker: "A", startSeconds: 252, endSeconds: 260, text: "Stop right there.", words: [], originalText: null, revision: 0 },
    ],
    ...over,
  }) as never;

beforeEach(() => {
  vi.mocked(requireUser).mockReset().mockResolvedValue("u1");
  vi.mocked(getCurrentUserTimeZone).mockReset().mockResolvedValue("America/Denver");
  vi.mocked(getDocumentTranscript).mockReset().mockResolvedValue(view());
  vi.mocked(getTranscriptCaption)
    .mockReset()
    .mockResolvedValue({ documentName: "bodycam.mp4", caption: "Alvarez v. City" });
});

describe("print transcript page", () => {
  test("guard redirect happens before any read", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(PrintTranscriptPage({ params, searchParams })).rejects.toThrow("NEXT_REDIRECT");
    expect(getDocumentTranscript).not.toHaveBeenCalled();
  });

  test("a walled user is refused and nothing else is read", async () => {
    vi.mocked(getDocumentTranscript).mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    await expect(PrintTranscriptPage({ params, searchParams })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getTranscriptCaption).not.toHaveBeenCalled();
  });

  test("404 when there is no transcript or it is not completed", async () => {
    vi.mocked(getDocumentTranscript).mockResolvedValueOnce(null);
    await expect(PrintTranscriptPage({ params, searchParams })).rejects.toThrow("NEXT_NOT_FOUND");
    vi.mocked(getDocumentTranscript).mockResolvedValueOnce(view({ status: "processing" }));
    await expect(PrintTranscriptPage({ params, searchParams })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("renders header, paragraphs and the uncorrected footer", async () => {
    const html = renderToStaticMarkup(await PrintTranscriptPage({ params, searchParams }));
    expect(html).toContain("Alvarez v. City");
    expect(html).toContain("bodycam.mp4");
    expect(html).toContain("[00:04:12]");
    expect(html).toContain("Officer Diaz");
    expect(html).toContain("Stop right there.");
    expect(html).toContain("Uncorrected machine transcript");
  });

  test("footer lives in @page margin boxes, not a fixed element", async () => {
    const html = renderToStaticMarkup(await PrintTranscriptPage({ params, searchParams }));
    expect(html).toContain("@bottom-left");
    expect(html).toContain('content: "Uncorrected machine transcript"');
    expect(html).toContain("@bottom-right");
    expect(html).toContain('content: "Page " counter(page)');
    expect(html).not.toMatch(/\bfixed\b/);
  });

  test("corrected transcript says who corrected it and uses the corrected footer", async () => {
    vi.mocked(getDocumentTranscript).mockResolvedValueOnce(
      view({ correctedAt: new Date("2026-10-02T18:00:00Z"), correctedByName: "Jo Park" }),
    );
    const html = renderToStaticMarkup(await PrintTranscriptPage({ params, searchParams }));
    expect(html).toContain("Corrected by Jo Park");
    expect(html).toContain("Machine transcript, corrected by staff");
    expect(html).not.toContain("Uncorrected machine transcript");
  });
});
