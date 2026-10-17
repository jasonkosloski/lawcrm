import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/create-stack/create-stack-provider", () => ({
  useCreateStack: () => ({ open: vi.fn() }),
}));

import { MatterCreateMenu } from "@/components/matters/matter-create-menu";

describe("MatterCreateMenu — allowedTypes", () => {
  test("lists only the entries the viewer may create", async () => {
    render(<MatterCreateMenu allowedTypes={["task", "time"]} />);
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText("Add task")).toBeTruthy();
    expect(screen.getByText("Log time")).toBeTruthy();
    expect(screen.queryByText("Schedule event")).toBeNull();
    expect(screen.queryByText("Create invoice")).toBeNull();
  });

  test("renders nothing at all when the viewer can create nothing", () => {
    const { container } = render(<MatterCreateMenu allowedTypes={[]} />);
    expect(container.innerHTML).toBe("");
  });

  test("no allowedTypes prop = every entry", async () => {
    render(<MatterCreateMenu />);
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText("Schedule event")).toBeTruthy();
    expect(screen.getByText("Create invoice")).toBeTruthy();
  });
});
