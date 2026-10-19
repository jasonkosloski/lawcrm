import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientShareBadge } from "./client-share-badge";

describe("ClientShareBadge", () => {
  test("renders nothing when not shared", () => {
    const { container } = render(<ClientShareBadge reason={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("a per-file share says Shared with client", () => {
    render(<ClientShareBadge reason={{ kind: "file" }} />);
    expect(screen.getByText("Shared")).toHaveAttribute("title", "Shared with client");
  });

  test("a folder share names the folder", () => {
    render(<ClientShareBadge reason={{ kind: "folder", folderName: "Medical" }} />);
    expect(screen.getByText("Shared")).toHaveAttribute("title", "Shared via folder Medical");
  });
});
