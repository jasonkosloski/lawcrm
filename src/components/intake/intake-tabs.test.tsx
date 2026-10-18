import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/intake/l1" }));

import { IntakeTabs } from "./intake-tabs";

describe("IntakeTabs", () => {
  test("Records follows Documents and is hidden without records.view", () => {
    const { unmount } = render(<IntakeTabs leadId="l1" />);
    const labels = screen.getAllByRole("link").map((l) => l.textContent);
    expect(labels.indexOf("Records")).toBe(labels.indexOf("Documents") + 1);
    unmount();
    render(<IntakeTabs leadId="l1" canViewRecords={false} />);
    expect(screen.queryByRole("link", { name: "Records" })).toBeNull();
  });
});
