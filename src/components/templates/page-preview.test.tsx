import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PagePreview } from "./page-preview";
import { renderFixture } from "@/lib/templates/converters-fixture";
import { DEFAULT_DOCUMENT_STYLE, resolvePageStyle } from "@/lib/templates/page-style";

const doc = renderFixture();
const props = (kind: "letter" | "filing", logoUrl: string | null) => ({
  body: doc,
  letterhead: doc,
  continuation: doc,
  logoUrl,
  style: resolvePageStyle(
    kind,
    { ...DEFAULT_DOCUMENT_STYLE, letterheadBlockId: "a", continuationBlockId: "b" },
    kind === "letter"
      ? { bytes: new Uint8Array(), contentType: "image/png", position: "center" }
      : null,
  ),
});

describe("PagePreview", () => {
  it("renders a letter page with logo, letterhead and page-2 strip, without ResizeObserver", () => {
    const { container } = render(<PagePreview {...props("letter", "/logo.png")} />);
    expect(container.querySelector("[data-page]")).not.toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/logo.png");
    expect(container.querySelector("[data-page-letterhead]")).not.toBeNull();
    expect(container.querySelector("[data-page2]")?.textContent).toContain("Page 2");
    expect(container.querySelector("style")?.textContent).toContain("@font-face");
  });
  it("letters: the header area reaches the top margin (Word's rule)", () => {
    const { container } = render(<PagePreview {...props("letter", "/logo.png")} />);
    const header = container.querySelector<HTMLElement>("[data-page-header]")!;
    expect(parseFloat(header.style.minHeight)).toBeCloseTo(96 - 47.2, 3);
    expect(header.querySelector("img")).not.toBeNull();
    expect(header.querySelector("[data-page-letterhead]")).not.toBeNull();
  });
  it("omits the logo without a url, and letterhead/strip content for a filing", () => {
    const { container } = render(<PagePreview {...props("filing", null)} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-page-letterhead]")).toBeNull();
    const strip = container.querySelector("[data-page2]");
    expect(strip?.textContent).toBe("Page 2");
  });
});
