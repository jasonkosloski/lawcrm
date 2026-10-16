/**
 * Pure helpers for `mergeContacts` (src/app/actions/contacts.ts):
 * what survives of the retired contact's conflict flag, internal
 * notes, and duplicate matter-party rows. Kept free of Prisma so the
 * precedence rules are unit-testable.
 */

export const CONTACT_NOTES_MAX = 4000;
/** partySchema's notes limit (src/app/actions/parties.ts). */
export const PARTY_NOTES_MAX = 4000;

const CONFLICT_RANK: Record<string, number> = {
  clear: 0,
  override: 1,
  flagged: 2,
};

/** flagged > override > clear. Unknown values rank as clear. */
export function mergeConflictStatus(survivor: string, loser: string): string {
  return (CONFLICT_RANK[loser] ?? 0) > (CONFLICT_RANK[survivor] ?? 0)
    ? loser
    : survivor;
}

/**
 * Append the loser's internal notes to the survivor's. Returns
 * `tooLong: true` instead of truncating when the result would exceed
 * the notes limit — silently dropping text is what this function
 * exists to prevent.
 */
export function mergeContactNotes(
  survivorNotes: string | null,
  loserNotes: string | null,
  loserName: string
): { notes: string | null; tooLong: boolean } {
  const l = loserNotes?.trim();
  if (!l) return { notes: survivorNotes, tooLong: false };
  const s = survivorNotes?.trim();
  if (s && s.includes(l)) return { notes: survivorNotes, tooLong: false };
  const block = `Merged from ${loserName}:\n${l}`;
  const notes = s ? `${s}\n\n${block}` : block;
  return { notes, tooLong: notes.length > CONTACT_NOTES_MAX };
}

export type PartyDetails = {
  role: string | null;
  notes: string | null;
  isRepresented: boolean | null;
  representationContactId: string | null;
  representationName: string | null;
  representationFirm: string | null;
  representationEmail: string | null;
  representationPhone: string | null;
};

function hasRepresentation(p: PartyDetails): boolean {
  return (
    p.isRepresented !== null ||
    p.representationContactId !== null ||
    p.representationName !== null ||
    p.representationFirm !== null ||
    p.representationEmail !== null ||
    p.representationPhone !== null
  );
}

function describeRepresentation(p: PartyDetails): string {
  const who = [p.representationName, p.representationFirm]
    .filter(Boolean)
    .join(", ");
  if (p.isRepresented === false) return "pro se";
  return who ? `represented by ${who}` : "represented";
}

/**
 * Fold the retired contact's duplicate party row into the survivor's
 * row for the same matter + category. Survivor values win; the
 * loser only fills gaps. Representation is treated as one block (a
 * linked attorney from one row is never mixed with free text from the
 * other). When BOTH rows carry different representation info, the
 * survivor's block is kept and the loser's is preserved as a line in
 * the notes so nothing is silently lost.
 */
export function mergePartyDetails(
  survivor: PartyDetails,
  loser: PartyDetails,
  loserName: string
): PartyDetails {
  const merged: PartyDetails = { ...survivor };
  merged.role = survivor.role ?? loser.role;

  const notes: string[] = [];
  const sn = survivor.notes?.trim();
  const ln = loser.notes?.trim();
  if (sn) notes.push(sn);
  if (ln && !sn?.includes(ln)) notes.push(ln);

  if (!hasRepresentation(survivor)) {
    merged.isRepresented = loser.isRepresented;
    merged.representationContactId = loser.representationContactId;
    merged.representationName = loser.representationName;
    merged.representationFirm = loser.representationFirm;
    merged.representationEmail = loser.representationEmail;
    merged.representationPhone = loser.representationPhone;
  } else if (hasRepresentation(loser)) {
    const same =
      survivor.isRepresented === loser.isRepresented &&
      survivor.representationContactId === loser.representationContactId &&
      survivor.representationName === loser.representationName &&
      survivor.representationFirm === loser.representationFirm;
    if (!same) {
      notes.push(
        `(${loserName} was also listed as ${describeRepresentation(loser)})`
      );
    }
  }

  merged.notes = notes.length > 0 ? notes.join("\n") : null;
  return merged;
}
