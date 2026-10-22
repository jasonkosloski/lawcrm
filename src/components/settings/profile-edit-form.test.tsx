/**
 * ProfileEditForm — validation-error round trip, accessibility,
 * time-zone fallback option.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/profile", () => ({ updateProfileAction: vi.fn() }));

import { updateProfileAction } from "@/app/actions/profile";
import { ProfileEditForm, type EditableProfile } from "@/components/settings/profile-edit-form";

const profile: EditableProfile = {
  name: "Pat Lawyer",
  initials: "PL",
  phone: "555-0100",
  barNumber: "12345",
  avatarUrl: null,
  timeZone: "America/Denver",
  defaultEventVisibility: "default",
};

beforeEach(() => {
  vi.mocked(updateProfileAction).mockReset();
});

describe("ProfileEditForm", () => {
  test("a validation error keeps the user's edits and re-posts them", async () => {
    const posted: FormData[] = [];
    vi.mocked(updateProfileAction).mockImplementation(async (_prev, fd) => {
      posted.push(fd);
      return posted.length === 1
        ? {
            status: "error" as const,
            errors: {
              avatarUrl: ["Avatar URL must start with http:// or https://"],
            },
            values: Object.fromEntries(fd.entries()) as Record<string, string>,
          }
        : { status: "ok" as const };
    });
    const user = userEvent.setup();
    render(<ProfileEditForm profile={profile} />);

    const name = screen.getByLabelText(/display name/i);
    await user.clear(name);
    await user.type(name, "Patricia Lawyer");
    const phone = screen.getByLabelText(/phone/i);
    await user.clear(phone);
    await user.type(phone, "555-0199");
    await user.type(screen.getByLabelText(/avatar url/i), "ftp://x.example/me.png");
    await user.selectOptions(screen.getByLabelText(/time zone/i), "America/Chicago");
    await user.click(screen.getByLabelText(/show details to everyone/i));

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await screen.findByText(/must start with http/i);

    // React 19's form-action reset used to snap all of these back.
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Patricia Lawyer");
    expect(screen.getByLabelText(/phone/i)).toHaveValue("555-0199");
    expect(screen.getByLabelText(/avatar url/i)).toHaveValue("ftp://x.example/me.png");
    expect(screen.getByLabelText(/time zone/i)).toHaveValue("America/Chicago");
    expect(screen.getByLabelText(/show details to everyone/i)).toBeChecked();

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].get("name")).toBe("Patricia Lawyer");
    expect(posted[1].get("timeZone")).toBe("America/Chicago");
    expect(posted[1].get("defaultEventVisibility")).toBe("show_details");
  });

  test("a stored zone outside the preset list stays selected and is re-posted", async () => {
    const posted: FormData[] = [];
    vi.mocked(updateProfileAction).mockImplementation(async (_prev, fd) => {
      posted.push(fd);
      return { status: "ok" as const };
    });
    const user = userEvent.setup();
    render(<ProfileEditForm profile={{ ...profile, timeZone: "America/Boise" }} />);

    expect(screen.getByLabelText(/time zone/i)).toHaveValue("America/Boise");

    await user.clear(screen.getByLabelText(/phone/i));
    await user.type(screen.getByLabelText(/phone/i), "555-0111");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(posted).toHaveLength(1));
    // Saving an unrelated field must not rewrite the zone.
    expect(posted[0].get("timeZone")).toBe("America/Boise");
  });

  test("every text field is labelled and the visibility radios form a named group", () => {
    render(<ProfileEditForm profile={profile} />);
    for (const label of [
      /display name/i,
      /initials/i,
      /phone/i,
      /bar number/i,
      /avatar url/i,
      /time zone/i,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: /default event visibility/i })).toBeInTheDocument();
  });

  test("phone and bar number are capped at the server's 40 characters", () => {
    render(<ProfileEditForm profile={profile} />);
    expect(screen.getByLabelText(/phone/i)).toHaveAttribute("maxlength", "40");
    expect(screen.getByLabelText(/bar number/i)).toHaveAttribute("maxlength", "40");
  });

  test("visibility copy does not promise a per-event override that doesn't exist", () => {
    render(<ProfileEditForm profile={profile} />);
    expect(document.body.textContent).not.toMatch(/still override this on any individual event/i);
    expect(document.body.textContent).toMatch(/ALL of your events, past and future/);
  });
});
