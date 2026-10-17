import { describe, expect, test } from "vitest";
import { normalizeVideoUrl } from "./calendar-event-form";

describe("normalizeVideoUrl", () => {
  test("blank input means no link", () => {
    expect(normalizeVideoUrl("")).toBe("");
    expect(normalizeVideoUrl("   ")).toBe("");
  });

  test("http(s) links pass through unchanged", () => {
    expect(normalizeVideoUrl("https://zoom.us/j/123?pwd=abc")).toBe(
      "https://zoom.us/j/123?pwd=abc"
    );
    expect(normalizeVideoUrl("http://meet.example.com/room")).toBe(
      "http://meet.example.com/room"
    );
    expect(normalizeVideoUrl("  https://zoom.us/j/1  ")).toBe(
      "https://zoom.us/j/1"
    );
  });

  test("a bare host gets https:// prepended", () => {
    expect(normalizeVideoUrl("zoom.us/j/123")).toBe("https://zoom.us/j/123");
    expect(normalizeVideoUrl("meet.google.com/abc-defg-hij")).toBe(
      "https://meet.google.com/abc-defg-hij"
    );
  });

  test("a host:port is a host, not a scheme", () => {
    expect(normalizeVideoUrl("zoom.us:8443/j/1")).toBe(
      "https://zoom.us:8443/j/1"
    );
  });

  test.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://files.example.com/x",
    "vbscript:msgbox(1)",
    "mailto:a@b.com",
  ])("%s is rejected", (bad) => {
    expect(normalizeVideoUrl(bad)).toBeNull();
  });

  test("garbage that cannot be a URL is rejected", () => {
    expect(normalizeVideoUrl("http://")).toBeNull();
    expect(normalizeVideoUrl("https://exa mple.com")).toBeNull();
  });
});
