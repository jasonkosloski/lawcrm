import { describe, expect, test, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NativeSelect, NativeSelectOption } from "./native-select";

describe("NativeSelect", () => {
  test("is a real labelled <select>: props, ref and change events reach it", async () => {
    const onChange = vi.fn();
    const ref = createRef<HTMLSelectElement>();
    render(
      <>
        <label htmlFor="fee">Fee</label>
        <NativeSelect
          id="fee"
          name="fee"
          ref={ref}
          defaultValue="hourly"
          onChange={onChange}
          className="w-full"
          aria-invalid
        >
          <NativeSelectOption value="hourly">Hourly</NativeSelectOption>
          <NativeSelectOption value="flat">Flat</NativeSelectOption>
        </NativeSelect>
      </>,
    );
    const select = screen.getByLabelText("Fee") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(ref.current).toBe(select);
    expect(select.name).toBe("fee");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    // className sizes the wrapper, not the select
    expect(select.parentElement?.className).toContain("w-full");

    await userEvent.selectOptions(select, "flat");
    expect(select.value).toBe("flat");
    expect(onChange).toHaveBeenCalledOnce();
  });

  test("posts its value with the form", () => {
    render(
      <form data-testid="f">
        <NativeSelect name="stage" defaultValue="b">
          <NativeSelectOption value="a">A</NativeSelectOption>
          <NativeSelectOption value="b">B</NativeSelectOption>
        </NativeSelect>
      </form>,
    );
    const fd = new FormData(screen.getByTestId("f") as HTMLFormElement);
    expect(fd.get("stage")).toBe("b");
  });
});
