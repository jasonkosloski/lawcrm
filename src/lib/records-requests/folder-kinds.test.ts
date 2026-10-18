import { describe, expect, test } from "vitest";
import {
  FOLDER_SYSTEM_KINDS,
  folderSourceLink,
  isProtectedFolder,
  kindForRole,
} from "@/lib/records-requests/folder-kinds";

describe("isProtectedFolder", () => {
  test("true for every kind, false for null", () => {
    for (const k of FOLDER_SYSTEM_KINDS) {
      expect(isProtectedFolder({ systemKind: k })).toBe(true);
    }
    expect(isProtectedFolder({ systemKind: null })).toBe(false);
  });
});

describe("folderSourceLink", () => {
  test("request folder links to its request", () => {
    expect(
      folderSourceLink(
        { systemKind: "records_request", recordsRequestId: "r1" },
        { kind: "matter", matterId: "m1" }
      )
    ).toEqual({ href: "/matters/m1/records/r1", label: "Records request" });
  });
  test("root links to the records list", () => {
    expect(
      folderSourceLink(
        { systemKind: "records_root", recordsRequestId: null },
        { kind: "lead", leadId: "l1" }
      )
    ).toEqual({ href: "/intake/l1/records", label: "Records requests" });
  });
  test("ordinary folder has no link", () => {
    expect(
      folderSourceLink(
        { systemKind: null, recordsRequestId: null },
        { kind: "matter", matterId: "m1" }
      )
    ).toBeNull();
  });
});

describe("kindForRole", () => {
  test("maps roles to subfolder kinds", () => {
    expect(kindForRole("request_letter")).toBe("records_request_docs");
    expect(kindForRole("received_records")).toBe("records_responsive_docs");
  });
});
