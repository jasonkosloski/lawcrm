/**
 * Tests for the slug-label formatter. Contract: raw snake_case
 * slugs never reach the screen — everything comes out title-cased
 * with the namespace prefix stripped, and clean input passes through.
 */

import { describe, expect, test } from "vitest";
import { formatEmailLabel } from "./format-label";

describe("formatEmailLabel", () => {
  test("null / undefined / empty → empty string", () => {
    expect(formatEmailLabel(null)).toBe("");
    expect(formatEmailLabel(undefined)).toBe("");
    expect(formatEmailLabel("")).toBe("");
  });

  test("single-word slug title-cases", () => {
    expect(formatEmailLabel("privileged")).toBe("Privileged");
    expect(formatEmailLabel("urgent")).toBe("Urgent");
  });

  test("multi-word snake_case splits and title-cases every word", () => {
    expect(formatEmailLabel("opposing_counsel")).toBe("Opposing Counsel");
    expect(formatEmailLabel("auto_filed")).toBe("Auto Filed");
    expect(formatEmailLabel("follow_up")).toBe("Follow Up");
  });

  test("a trailing _label is part of the name (real Gmail user labels), not noise", () => {
    expect(formatEmailLabel("privileged_label")).toBe("Privileged Label");
    expect(formatEmailLabel("custom:shipping_label")).toBe("Shipping Label");
    expect(formatEmailLabel("custom:white-label")).toBe("White Label");
    // "Privileged" and "Privileged Label" stay distinguishable.
    expect(formatEmailLabel("privileged")).not.toBe(
      formatEmailLabel("custom:privileged_label")
    );
  });

  test("custom: namespace prefix strips", () => {
    expect(formatEmailLabel("custom:fee_dispute")).toBe("Fee Dispute");
    expect(formatEmailLabel("custom:fee_dispute_2")).toBe("Fee Dispute 2");
  });

  test("hyphens and screaming-case normalize too", () => {
    expect(formatEmailLabel("auto-filed")).toBe("Auto Filed");
    expect(formatEmailLabel("IMPORTANT")).toBe("Important");
    expect(formatEmailLabel("CATEGORY_UPDATES")).toBe("Category Updates");
  });

  test("already-clean input passes through", () => {
    expect(formatEmailLabel("Privileged")).toBe("Privileged");
  });
});
