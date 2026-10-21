import { describe, expect, test } from "vitest";
import {
  digestNotificationEmail,
  instantNotificationEmail,
} from "@/lib/notification-emails";

const BASE = "https://app.test";
const item = (over: Partial<Parameters<typeof instantNotificationEmail>[0]> = {}) => ({
  title: "Task assigned: draft complaint",
  body: "Smith v. Jones",
  link: "/matters/m1",
  type: "task_assigned",
  ...over,
});

describe("instantNotificationEmail", () => {
  test("instant uses title as subject", () => {
    expect(instantNotificationEmail(item(), BASE).subject).toBe(
      "Task assigned: draft complaint"
    );
  });

  test("absolute link", () => {
    const e = instantNotificationEmail(item(), BASE);
    expect(e.html).toContain('href="https://app.test/matters/m1"');
    expect(e.html).toContain("Open in LitGox");
    expect(e.text).toContain("https://app.test/matters/m1");
  });

  test("no link no button", () => {
    const e = instantNotificationEmail(item({ link: null }), BASE);
    expect(e.html).not.toContain("Open in LitGox");
    expect(e.text).not.toContain("/matters/");
  });

  test("escapes html", () => {
    const title = 'Smith & Sons <LLC> "x"';
    const e = instantNotificationEmail(item({ title, body: null }), BASE);
    expect(e.html).toContain("Smith &amp; Sons &lt;LLC&gt; &quot;x&quot;");
    expect(e.html).not.toContain("<LLC>");
    expect(e.text).toContain(title);
  });

  test("footer links to settings", () => {
    const e = instantNotificationEmail(item(), BASE);
    expect(e.html).toContain('href="https://app.test/settings/notifications"');
    expect(e.html).toContain("Change email notification settings");
    expect(e.text).toContain("https://app.test/settings/notifications");
  });
});

describe("digestNotificationEmail", () => {
  test("digest groups by category in order", () => {
    const e = digestNotificationEmail(
      [
        item({ title: "Task one" }),
        item({ title: "Deadline soon", type: "deadline_approaching" }),
      ],
      BASE
    );
    const deadlines = e.html.indexOf(">Deadlines<");
    const tasks = e.html.indexOf(">Tasks<");
    expect(deadlines).toBeGreaterThan(-1);
    expect(tasks).toBeGreaterThan(deadlines);
    expect(e.html).not.toContain(">Billing<");
    expect(e.text.indexOf("Deadline soon")).toBeLessThan(
      e.text.indexOf("Task one")
    );
  });

  test("digest subject pluralises", () => {
    expect(digestNotificationEmail([item()], BASE).subject).toBe(
      "Your daily summary: 1 notification"
    );
    expect(digestNotificationEmail([item(), item()], BASE).subject).toBe(
      "Your daily summary: 2 notifications"
    );
  });

  test("digest footer links to settings", () => {
    expect(digestNotificationEmail([item()], BASE).html).toContain(
      "https://app.test/settings/notifications"
    );
  });
});
