/**
 * The login sheet's RECEIVED stamp: Denver-zone formatting (DST, the
 * date boundary against UTC, court-style month abbreviations) and that
 * the component renders an accessible reading of it.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReceivedStamp, formatReceivedStamp } from "./received-stamp";

describe("formatReceivedStamp", () => {
  test("formats an afternoon in Denver daylight time", () => {
    expect(formatReceivedStamp(new Date("2026-10-20T22:02:00Z"))).toEqual({
      date: "Oct. 20, 2026",
      time: "4:02 p.m. MDT",
    });
  });

  test("uses standard time in winter", () => {
    expect(formatReceivedStamp(new Date("2026-01-05T15:30:00Z"))).toEqual({
      date: "Jan. 5, 2026",
      time: "8:30 a.m. MST",
    });
  });

  test("stays on the Denver date when UTC has rolled over", () => {
    expect(formatReceivedStamp(new Date("2026-10-21T03:00:00Z"))).toEqual({
      date: "Oct. 20, 2026",
      time: "9:00 p.m. MDT",
    });
  });

  test("May takes no abbreviation period", () => {
    expect(formatReceivedStamp(new Date("2026-05-01T18:00:00Z")).date).toBe(
      "May 1, 2026"
    );
  });
});

describe("ReceivedStamp", () => {
  test("labels the stamp with the full reading", () => {
    render(<ReceivedStamp />);
    expect(
      screen.getByLabelText(/^Received .+, \d{1,2}:\d{2} [ap]\.m\. M[DS]T, Denver, Colorado$/)
    ).toBeInTheDocument();
  });
});
