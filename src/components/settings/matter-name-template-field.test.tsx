import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MatterNameTemplateField } from "./matter-name-template-field";
import { DEFAULT_MATTER_NAME_TEMPLATE } from "@/lib/matter-name-template";

describe("MatterNameTemplateField", () => {
  test("previews the default template with sample values", () => {
    render(<MatterNameTemplateField defaultValue={DEFAULT_MATTER_NAME_TEMPLATE} />);
    expect(screen.getByTestId("template-preview").textContent).toBe(
      "Alvarez, Maria - 2026-CV-00481 - Aurora",
    );
  });

  test("shows the parse error for an unknown token", async () => {
    render(<MatterNameTemplateField defaultValue="" />);
    await userEvent.type(screen.getByRole("textbox"), "{{nope}");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("template-preview")).toBeNull();
  });

  test("blank value previews the inherited placeholder", () => {
    render(<MatterNameTemplateField defaultValue="" placeholder="{client_full} - {year}" />);
    expect(screen.getByTestId("template-preview").textContent).toMatch(/^Maria Alvarez - \d{4}$/);
  });
});
