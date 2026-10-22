/**
 * Field picker: catalog groups in FIELD_GROUPS order with sample-value
 * examples, filtered by applies-to; inside a repeat the list's item
 * fields come first; search narrows the entries.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FIELD_GROUPS, LISTS, SAMPLE_TEMPLATE_DATA, fieldsForScope } from "@/lib/templates/catalog";
import { FieldPicker } from "./field-picker";

const groupTitles = (container: HTMLElement) =>
  [...container.querySelectorAll(".text-2xs.font-medium")].map((n) => n.textContent);

describe("FieldPicker", () => {
  it("shows lead-scope groups in catalog order with example values", () => {
    const { container } = render(
      <FieldPicker
        fields={fieldsForScope("lead")}
        lists={[]}
        repeatList={null}
        data={{ ...SAMPLE_TEMPLATE_DATA, scope: "lead" }}
        onPickField={() => {}}
      />,
    );
    const titles = groupTitles(container);
    expect(titles).not.toContain("Matter");
    expect(titles).toEqual(FIELD_GROUPS.filter((g) => titles.includes(g)));
    expect(screen.getByText(SAMPLE_TEMPLATE_DATA.firm.name)).toBeInTheDocument();
  });

  it("puts the repeat's item fields first and inserts item paths", async () => {
    const user = userEvent.setup();
    const pick = vi.fn();
    const { container } = render(
      <FieldPicker
        fields={fieldsForScope("matter")}
        lists={[...LISTS]}
        repeatList="parties.defendants"
        data={SAMPLE_TEMPLATE_DATA}
        onPickField={pick}
      />,
    );
    expect(groupTitles(container)[0]).toBe("Each defendants");
    await user.type(screen.getByLabelText("Search fields"), "counsel email");
    const buttons = screen.getAllByRole("button");
    await user.click(buttons[0]!);
    expect(pick).toHaveBeenCalledWith("item.counsel.email");
  });
});
