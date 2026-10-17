/**
 * Matters list URL-state controls: toolbar (search debounce, filter
 * popovers, Clear all), view toggle and sortable headers. The router is
 * mocked and the committed URL never updates between calls - the shape
 * of the "navigation still in flight" window in which the old code
 * built each URL from stale params and the writes overwrote each other.
 * Rapid interactions share one act() because the mock router settles
 * its transition immediately (a real navigation stays pending until the
 * server round trip commits).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const router = { replace: vi.fn() };
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

import { EMPTY_FILTER } from "@/lib/matters-filters";
import { MattersToolbar } from "./matters-toolbar";
import { MattersViewToggle } from "./matters-view-toggle";
import { SortableHead, SortableHeader } from "./sortable-header";
import {
  Table,
  TableBody,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const options = {
  areas: ["§1983", "Housing/FHA"],
  stages: ["Intake", "Discovery"],
  feeStructures: ["contingency"],
  leads: [{ id: "u1", name: "Pat Lee", initials: "PL" }],
};

function renderToolbar(filter = EMPTY_FILTER) {
  return render(
    <MattersToolbar
      filter={filter}
      options={options}
      view="table"
      visibleCount={3}
      totalCount={3}
    />
  );
}

function urls(): string[] {
  return router.replace.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  router.replace.mockReset();
  search = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MattersToolbar — filter writes compose (F318)", () => {
  test("checking two areas back-to-back keeps both", async () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Area" }));
    const first = await screen.findByRole("button", { name: /§1983/ });
    const second = screen.getByRole("button", { name: /Housing\/FHA/ });
    act(() => {
      fireEvent.click(first);
      fireEvent.click(second);
    });
    const last = new URLSearchParams(urls().at(-1)!.slice(1));
    expect(last.getAll("area")).toEqual(["§1983", "Housing/FHA"]);
  });
});

describe("MattersToolbar — search debounce (F318)", () => {
  test("typing writes q once, after the debounce", () => {
    vi.useFakeTimers();
    renderToolbar();
    const box = screen.getByLabelText("Search matters");
    fireEvent.change(box, { target: { value: "al" } });
    fireEvent.change(box, { target: { value: "alv" } });
    expect(router.replace).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(urls()).toEqual(["?q=alv"]);
  });

  test("a filter click while a search is pending still lands on the same URL as the search", () => {
    vi.useFakeTimers();
    renderToolbar();
    fireEvent.change(screen.getByLabelText("Search matters"), {
      target: { value: "alv" },
    });
    act(() => {
      vi.advanceTimersByTime(300);
      // Navigation for q=alv is "in flight" (committed URL still empty).
      fireEvent.click(screen.getByRole("switch", { name: /show closed/i }));
    });
    const last = new URLSearchParams(urls().at(-1)!.slice(1));
    expect(last.get("q")).toBe("alv");
    expect(last.get("show_closed")).toBe("1");
  });

  test("Clear all cancels a pending search and empties the box", () => {
    vi.useFakeTimers();
    search = "area=%C2%A71983";
    renderToolbar({ ...EMPTY_FILTER, areas: ["§1983"] });
    const box = screen.getByLabelText("Search matters") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "alv" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Only the Clear all write happened; the timer did not re-apply q.
    expect(urls()).toEqual(["?"]);
    expect(box.value).toBe("");
  });
});

describe("MattersToolbar — Clear all visibility (F781)", () => {
  test("is hidden with no filters", () => {
    renderToolbar();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  test("shows when only Show closed is on, and clears show_closed", () => {
    search = "show_closed=1";
    renderToolbar({ ...EMPTY_FILTER, showClosed: true });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(urls()).toEqual(["?"]);
  });

  test("clears every filter key but keeps sort and view", () => {
    search = "q=a&area=x&stage=y&lead=1&fee=f&trust=has&deadline=overdue&archived=1&pinned=1&show_closed=1&sort=name&dir=asc&view=kanban";
    renderToolbar({ ...EMPTY_FILTER, q: "a" });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(urls()).toEqual(["?sort=name&dir=asc&view=kanban"]);
  });
});

describe("MattersToolbar — accessibility (F782)", () => {
  test("search is labelled and filter options expose their state", async () => {
    renderToolbar({ ...EMPTY_FILTER, areas: ["Housing/FHA"] });
    expect(screen.getByLabelText("Search matters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Area/ }));
    const list = within(await screen.findByRole("list"));
    const on = list.getByRole("button", { name: /Housing\/FHA/ });
    const off = list.getByRole("button", { name: /§1983/ });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(off).toHaveAttribute("aria-pressed", "false");
  });
});

describe("MattersViewToggle", () => {
  test("kanban writes ?view=kanban; table drops the default param", () => {
    search = "q=a";
    const { rerender } = render(<MattersViewToggle view="table" />);
    fireEvent.click(screen.getByRole("button", { name: /kanban/i }));
    expect(urls().at(-1)).toBe("?q=a&view=kanban");
    search = "q=a&view=kanban";
    rerender(<MattersViewToggle view="kanban" />);
    fireEvent.click(screen.getByRole("button", { name: /table/i }));
    expect(urls().at(-1)).toBe("?q=a");
  });
});

describe("SortableHeader — three-state cycle (F318, F785)", () => {
  test("asc -> desc -> cleared", () => {
    const { rerender } = render(
      <SortableHeader field="name">Matter</SortableHeader>
    );
    fireEvent.click(screen.getByRole("button", { name: "Matter" }));
    expect(urls().at(-1)).toBe("?sort=name&dir=asc");

    search = "sort=name&dir=asc";
    rerender(<SortableHeader field="name">Matter</SortableHeader>);
    fireEvent.click(screen.getByRole("button", { name: "Matter" }));
    expect(urls().at(-1)).toBe("?sort=name&dir=desc");

    search = "sort=name&dir=desc";
    rerender(<SortableHeader field="name">Matter</SortableHeader>);
    fireEvent.click(screen.getByRole("button", { name: "Matter" }));
    expect(urls().at(-1)).toBe("?");
  });

  test("two quick clicks advance the cycle instead of repeating the first", () => {
    render(<SortableHeader field="trust">Trust</SortableHeader>);
    const btn = screen.getByRole("button", { name: "Trust" });
    act(() => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(urls()).toEqual(["?sort=trust&dir=asc", "?sort=trust&dir=desc"]);
  });

  test("clicking a different column starts that column ascending", () => {
    search = "sort=name&dir=desc";
    render(<SortableHeader field="area">Area</SortableHeader>);
    fireEvent.click(screen.getByRole("button", { name: "Area" }));
    expect(urls().at(-1)).toBe("?sort=area&dir=asc");
  });
});

describe("SortableHead — aria-sort (F782)", () => {
  function head(field: "name" | "area") {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead field={field}>Col</SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody />
      </Table>
    );
  }

  test("none when the column is not the active sort", () => {
    render(head("name"));
    expect(screen.getByRole("columnheader")).toHaveAttribute(
      "aria-sort",
      "none"
    );
  });

  test("ascending / descending follow the URL", () => {
    search = "sort=name&dir=asc";
    const { rerender } = render(head("name"));
    expect(screen.getByRole("columnheader")).toHaveAttribute(
      "aria-sort",
      "ascending"
    );
    search = "sort=name&dir=desc";
    rerender(head("name"));
    expect(screen.getByRole("columnheader")).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });
});
