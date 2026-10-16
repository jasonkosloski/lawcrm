import { describe, expect, test } from "vitest";
import {
  CONTACT_NOTES_MAX,
  mergeConflictStatus,
  mergeContactNotes,
  mergePartyDetails,
  type PartyDetails,
} from "./contact-merge";

const blank: PartyDetails = {
  role: null,
  notes: null,
  isRepresented: null,
  representationContactId: null,
  representationName: null,
  representationFirm: null,
  representationEmail: null,
  representationPhone: null,
};

describe("mergeConflictStatus", () => {
  test("flagged > override > clear, regardless of side", () => {
    expect(mergeConflictStatus("clear", "flagged")).toBe("flagged");
    expect(mergeConflictStatus("flagged", "clear")).toBe("flagged");
    expect(mergeConflictStatus("clear", "override")).toBe("override");
    expect(mergeConflictStatus("override", "flagged")).toBe("flagged");
    expect(mergeConflictStatus("clear", "clear")).toBe("clear");
  });
});

describe("mergeContactNotes", () => {
  test("appends the loser's notes under a merge header", () => {
    const r = mergeContactNotes("keep", "do not call", "Dup");
    expect(r.tooLong).toBe(false);
    expect(r.notes).toBe("keep\n\nMerged from Dup:\ndo not call");
  });
  test("no loser notes -> survivor unchanged; no survivor notes -> just the block", () => {
    expect(mergeContactNotes("keep", null, "Dup").notes).toBe("keep");
    expect(mergeContactNotes(null, "x", "Dup").notes).toBe("Merged from Dup:\nx");
  });
  test("does not duplicate notes already contained", () => {
    expect(mergeContactNotes("a b c", "b", "Dup").notes).toBe("a b c");
  });
  test("flags (never truncates) an over-limit result", () => {
    const r = mergeContactNotes("x".repeat(CONTACT_NOTES_MAX), "y", "Dup");
    expect(r.tooLong).toBe(true);
  });
});

describe("mergePartyDetails", () => {
  test("fills the survivor's gaps from the loser, including the representation block", () => {
    const loser: PartyDetails = {
      ...blank,
      role: "Defendant",
      notes: "Served 3/1",
      isRepresented: true,
      representationContactId: "atty",
      representationName: "City Attorney",
    };
    expect(mergePartyDetails(blank, loser, "Ruiz")).toEqual({
      ...loser,
    });
  });

  test("survivor values win; a differing loser representation is preserved in notes", () => {
    const survivor: PartyDetails = {
      ...blank,
      role: "Officer",
      isRepresented: false,
    };
    const loser: PartyDetails = {
      ...blank,
      role: "Defendant",
      isRepresented: true,
      representationName: "Sonia Steele",
      representationFirm: "Steele & Marsh",
    };
    const merged = mergePartyDetails(survivor, loser, "Ofc. Ruiz");
    expect(merged.role).toBe("Officer");
    expect(merged.isRepresented).toBe(false);
    expect(merged.notes).toContain("Ofc. Ruiz was also listed as represented by");
    expect(merged.notes).toContain("Sonia Steele");
  });
});
