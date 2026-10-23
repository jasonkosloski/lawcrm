// @vitest-environment happy-dom
/** LinkButton: set / change / remove a link with the email link rule. */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import { emailExtensions } from "../presets";
import { LinkButton } from "./link-button";

function setup(content = "<p>hello</p>") {
  const editor = new Editor({ extensions: emailExtensions(), content });
  render(<LinkButton editor={editor} />);
  act(() => {
    editor.commands.selectAll();
  });
  return editor;
}
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("LinkButton", () => {
  it("is disabled with no selection and not on a link", () => {
    const editor = new Editor({ extensions: emailExtensions(), content: "<p>hello</p>" });
    render(<LinkButton editor={editor} />);
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
  });

  it("sets a link, adding https:// to a bare domain", async () => {
    const u = user();
    const editor = setup();
    await u.click(screen.getByRole("button", { name: "Link" }));
    await u.type(await screen.findByLabelText("Link URL"), "example.com");
    await u.click(screen.getByRole("button", { name: "Apply" }));
    expect(editor.getHTML()).toContain('href="https://example.com"');
  });

  it("refuses javascript: and relative URLs", async () => {
    const u = user();
    const editor = setup();
    await u.click(screen.getByRole("button", { name: "Link" }));
    await u.type(await screen.findByLabelText("Link URL"), "javascript:alert(1)");
    await u.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/http\(s\), mailto or tel/)).toBeInTheDocument();
    expect(editor.getHTML()).not.toContain("<a");
  });

  it("accepts a tel: link", async () => {
    const u = user();
    const editor = setup();
    await u.click(screen.getByRole("button", { name: "Link" }));
    await u.type(await screen.findByLabelText("Link URL"), "tel:+15551234567");
    await u.click(screen.getByRole("button", { name: "Apply" }));
    expect(editor.getHTML()).toContain('href="tel:+15551234567"');
  });

  it("an empty URL removes the link", async () => {
    const u = user();
    const editor = setup('<p><a href="https://example.com">hello</a></p>');
    await u.click(screen.getByRole("button", { name: "Link" }));
    const input = await screen.findByLabelText("Link URL");
    expect(input).toHaveValue("https://example.com");
    await u.clear(input);
    await u.click(screen.getByRole("button", { name: "Remove link" }));
    expect(editor.getHTML()).not.toContain("<a");
  });
});
