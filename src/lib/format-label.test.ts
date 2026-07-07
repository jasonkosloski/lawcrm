/**
 * Tests for the slug-label formatter. Contract: raw snake_case
 * slugs never reach the screen — everything comes out title-cased
 * with prefixes/suffixes stripped, and clean input passes through.
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

  test("redundant _label suffix strips", () => {
    expect(formatEmailLabel("privileged_label")).toBe("Privileged");
    expect(formatEmailLabel("opposing_counsel_label")).toBe(
      "Opposing Counsel"
    );
  });

  test("custom: namespace prefix strips", () => {
    expect(formatEmailLabel("custom:fee_dispute")).toBe("Fee Dispute");
    expect(formatEmailLabel("custom:privileged_label")).toBe("Privileged");
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
