import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { FolderSourceBadge } from "./folder-source-badge";

const scope = { kind: "matter", matterId: "m1" } as const;

describe("FolderSourceBadge", () => {
  test("a request folder links to its request, titled with the subject", () => {
    render(
      <FolderSourceBadge
        scope={scope}
        folder={{
          systemKind: "records_request",
          recordsRequestId: "r1",
          sourceTitle: "Dr. Smith — Medical",
        }}
      />,
    );
    const link = screen.getByRole("link", { name: /Records request/ });
    expect(link).toHaveAttribute("href", "/matters/m1/records/r1");
    expect(link).toHaveAttribute("title", "Dr. Smith — Medical");
  });

  test("the records root links to the records list", () => {
    render(
      <FolderSourceBadge
        scope={scope}
        folder={{ systemKind: "records_root", recordsRequestId: null }}
      />,
    );
    expect(screen.getByRole("link", { name: /Records requests/ })).toHaveAttribute(
      "href",
      "/matters/m1/records",
    );
  });

  test("an ordinary folder renders nothing", () => {
    const { container } = render(
      <FolderSourceBadge scope={scope} folder={{ systemKind: null, recordsRequestId: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
