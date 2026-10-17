/**
 * MatterCreateMenu: "Add note" opens the dock panel (it has a working
 * form there); every other entry navigates to the matter tab whose
 * composer actually works instead of opening a placeholder panel.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const stack = vi.hoisted(() => ({
  open: vi.fn(),
  context: { matterId: "m1" } as { matterId: string | null } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));
vi.mock("@/components/create-stack/create-stack-provider", () => ({
  useCreateStack: () => ({ open: stack.open, context: stack.context }),
}));

import { MatterCreateMenu } from "./matter-create-menu";

beforeEach(() => {
  router.push.mockReset();
  stack.open.mockReset();
  stack.context = { matterId: "m1" };
});

async function openMenu() {
  const user = userEvent.setup();
  render(<MatterCreateMenu />);
  await user.click(screen.getByRole("button", { name: /create/i }));
  return user;
}

describe("MatterCreateMenu", () => {
  test("lists all eight entries", async () => {
    await openMenu();
    for (const label of [
      "Log time",
      "Add note",
      "Add task",
      "Add deadline",
      "Add party",
      "Upload document",
      "Schedule event",
      "Create invoice",
    ]) {
      expect(await screen.findByRole("menuitem", { name: label })).toBeTruthy();
    }
  });

  test("Add note opens the dock panel", async () => {
    const user = await openMenu();
    await user.click(await screen.findByRole("menuitem", { name: "Add note" }));
    expect(stack.open).toHaveBeenCalledWith("note");
    expect(router.push).not.toHaveBeenCalled();
  });

  test.each([
    ["Log time", "/matters/m1/time"],
    ["Add task", "/matters/m1/tasks"],
    ["Add deadline", "/matters/m1/deadlines"],
    ["Add party", "/matters/m1/parties"],
    ["Upload document", "/matters/m1/documents"],
    ["Schedule event", "/matters/m1/events"],
    ["Create invoice", "/matters/m1/billing"],
  ])("%s goes to its working composer tab", async (label, href) => {
    const user = await openMenu();
    await user.click(await screen.findByRole("menuitem", { name: label }));
    expect(router.push).toHaveBeenCalledWith(href);
    expect(stack.open).not.toHaveBeenCalled();
  });

  test("allowedTypes hides entries the viewer can't create", async () => {
    const user = userEvent.setup();
    render(<MatterCreateMenu allowedTypes={["note", "task"]} />);
    await user.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByRole("menuitem", { name: "Add task" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Log time" })).toBeNull();
  });

  test("renders nothing at all when the viewer can create nothing", () => {
    const { container } = render(<MatterCreateMenu allowedTypes={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
