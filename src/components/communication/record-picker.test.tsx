/**
 * RecordPicker: grouped Matters / Leads, client-side search, pure
 * selection (emits a RecordScope, no server calls).
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FilingLeadOption, FilingMatterOption } from "@/lib/queries/communication";
import { RecordPicker } from "./record-picker";

const matters = [
  {
    id: "m1",
    name: "Smith v. Jones",
    color: "#123456",
    area: "Civil",
    isPinned: false,
  },
] as unknown as FilingMatterOption[];
const leads = [
  { id: "l1", name: "Pat Prospect", stage: "new" },
  { id: "l2", name: "Quinn Caller", stage: "contacted" },
] as unknown as FilingLeadOption[];

const setup = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("RecordPicker", () => {
  test("groups matters and leads", () => {
    render(<RecordPicker matters={matters} leads={leads} value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Matters" })).toHaveTextContent("Smith v. Jones");
    expect(screen.getByRole("region", { name: "Leads" })).toHaveTextContent("Pat Prospect");
  });

  test("search filters both groups and hides an emptied group", async () => {
    const user = setup();
    render(<RecordPicker matters={matters} leads={leads} value={null} onChange={vi.fn()} />);
    await user.type(screen.getByRole("textbox"), "quinn");
    expect(screen.queryByText("Smith v. Jones")).toBeNull();
    expect(screen.queryByText("Pat Prospect")).toBeNull();
    expect(screen.getByText("Quinn Caller")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Matters" })).toBeNull();
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "zzz");
    expect(screen.getByText("No matters or leads match.")).toBeInTheDocument();
  });

  test("selecting emits the scope", async () => {
    const user = setup();
    const onChange = vi.fn();
    render(<RecordPicker matters={matters} leads={leads} value={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Pat Prospect/ }));
    expect(onChange).toHaveBeenCalledWith({ kind: "lead", leadId: "l1" });
    await user.click(screen.getByRole("button", { name: /Smith v\. Jones/ }));
    expect(onChange).toHaveBeenCalledWith({ kind: "matter", matterId: "m1" });
  });
});
