/**
 * EmailLink / mailtoHref (F987) - the stored address is free text, so
 * the href must encode it and refuse values that are not one address.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";

import { EmailLink, mailtoHref } from "./email-link";

describe("mailtoHref", () => {
  test("plain addresses keep a readable mailto", () => {
    expect(mailtoHref("dana@example.com")).toBe("mailto:dana@example.com");
    expect(mailtoHref("  dana@example.com  ")).toBe("mailto:dana@example.com");
    expect(mailtoHref("dana+matter@example.com")).toBe(
      "mailto:dana+matter@example.com"
    );
  });

  test("# is encoded so the mailto does not truncate at a fragment", () => {
    expect(mailtoHref("billing#2@firm.com")).toBe("mailto:billing%232@firm.com");
  });

  test("a ?bcc= header injection is not a link at all", () => {
    expect(mailtoHref("client@x.com?bcc=other@y.com")).toBeNull();
  });

  test("? & % inside an otherwise single address are percent-encoded", () => {
    const href = mailtoHref("we?ird&na%me@x.com")!;
    expect(href).toBe("mailto:we%3Fird%26na%25me@x.com");
    expect(href).not.toMatch(/[?&#]/);
  });

  test("multiple recipients, display names and whitespace are refused", () => {
    expect(mailtoHref("a@x.com,b@y.com")).toBeNull();
    expect(mailtoHref("a@x.com;b@y.com")).toBeNull();
    expect(mailtoHref("Dana <a@x.com>")).toBeNull();
    expect(mailtoHref("a b@x.com")).toBeNull();
    expect(mailtoHref("a@x.com\r\nBcc: z@y.com")).toBeNull();
    expect(mailtoHref("no-at-sign")).toBeNull();
    expect(mailtoHref("a@@x.com")).toBeNull();
  });

  test("empty values", () => {
    expect(mailtoHref("")).toBeNull();
    expect(mailtoHref("   ")).toBeNull();
    expect(mailtoHref(null)).toBeNull();
    expect(mailtoHref(undefined)).toBeNull();
  });
});

describe("EmailLink", () => {
  test("renders an encoded mailto anchor for a valid address", () => {
    render(<EmailLink email="billing#2@firm.com" />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "mailto:billing%232@firm.com"
    );
  });

  test("renders plain text, not a link, for an injected value", () => {
    render(<EmailLink email="client@x.com?bcc=other@y.com" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("client@x.com?bcc=other@y.com")).toBeInTheDocument();
  });

  test("renders nothing for an empty value", () => {
    const { container } = render(<EmailLink email={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
