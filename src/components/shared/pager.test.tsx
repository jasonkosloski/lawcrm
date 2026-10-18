import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pager, TruncationNotice } from "./pager";

describe("Pager", () => {
  test("renders nothing for a single page", () => {
    const { container } = render(
      <Pager page={1} pageCount={1} total={3} pageSize={50} href="/x" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("middle page: both links, range text, filters preserved", () => {
    render(
      <Pager page={2} pageCount={3} total={120} pageSize={50} href="/x?filter=a" />
    );
    expect(screen.getByText(/51–100 of 120 · page 2\/3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute(
      "href",
      "/x?filter=a"
    );
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute(
      "href",
      "/x?filter=a&page=3"
    );
  });

  test("first and last pages disable the edge link", () => {
    const { rerender } = render(
      <Pager page={1} pageCount={2} total={60} pageSize={50} href="/x" />
    );
    expect(screen.queryByRole("link", { name: /Previous/ })).toBeNull();
    expect(screen.getByText(/Previous/).closest("[aria-disabled]")).not.toBeNull();

    rerender(<Pager page={2} pageCount={2} total={60} pageSize={50} href="/x" />);
    expect(screen.queryByRole("link", { name: /Next/ })).toBeNull();
  });

  test("custom labels", () => {
    render(
      <Pager
        page={2}
        pageCount={3}
        total={120}
        pageSize={50}
        href="/n"
        prevLabel="Newer"
        nextLabel="Older"
      />
    );
    expect(screen.getByRole("link", { name: /Older/ })).toHaveAttribute("href", "/n?page=3");
  });
});

describe("TruncationNotice", () => {
  test("with a known total", () => {
    render(<TruncationNotice shown={500} total={812} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing the first 500 of 812. Refine your filter to narrow the list."
    );
  });

  test("without a total, and a custom hint", () => {
    render(<TruncationNotice shown={500} hint="Search instead." />);
    expect(screen.getByRole("status")).toHaveTextContent("Showing the first 500. Search instead.");
  });
});
