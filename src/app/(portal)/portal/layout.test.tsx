import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/portal-access", () => ({
  getPortalIdentity: vi.fn(async () => ({ email: "jane@example.com" })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    firm: {
      findFirst: vi.fn(async () => ({
        name: "Acme Law",
        logoUrl: null,
        phone: "555-0100",
        email: "a@acme.test",
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        zip: null,
      })),
    },
  },
}));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("./sign-out-button", () => ({ SignOutButton: () => <button>Sign out</button> }));

import PortalLayout from "./layout";

describe("portal layout", () => {
  test("header and footer are hidden when printing", async () => {
    const { container } = render(await PortalLayout({ children: <p>content</p> }));
    expect(container.querySelector("header")?.className).toContain("print:hidden");
    expect(container.querySelector("footer")?.className).toContain("print:hidden");
  });

  test("main drops its padding and width cap when printing", async () => {
    const { container } = render(await PortalLayout({ children: <p>content</p> }));
    const cls = container.querySelector("main")?.className ?? "";
    expect(cls).toContain("print:p-0");
    expect(cls).toContain("print:max-w-none");
  });
});
