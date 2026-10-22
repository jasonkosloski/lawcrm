/**
 * Court-format block replacement. Pure and client-safe: no server imports.
 * A court format swaps some default blocks for court-specific ones; the
 * swap is applied to the block map before rendering, so every reference
 * to the default block (in the template or inside inserted blocks)
 * renders the replacement.
 */

import type { CourtFormatValues } from "./page-style";
import type { BlockSource } from "./render";

/** A venue's court format as rendering needs it. `replacements` is keyed
 *  by the default block id. */
export type CourtContext = {
  id: string;
  name: string;
  isActive: boolean;
  values: CourtFormatValues;
  replacements: Map<string, BlockSource>;
};

/** JSON-safe form of a CourtContext, for passing to client components. */
export type SerializedCourtContext = {
  id: string;
  name: string;
  isActive: boolean;
  values: CourtFormatValues;
  replacements: [string, BlockSource][];
};

export function toSerializedCourt(c: CourtContext): SerializedCourtContext {
  return { ...c, replacements: [...c.replacements.entries()] };
}

export function fromSerializedCourt(s: SerializedCourtContext): CourtContext {
  return { ...s, replacements: new Map(s.replacements) };
}

/** A new map where each key in `replacements` maps to its replacement. */
export function applyCourtBlocks(
  blocks: Map<string, BlockSource>,
  replacements: ReadonlyMap<string, BlockSource>,
): Map<string, BlockSource> {
  const out = new Map(blocks);
  for (const [id, source] of replacements) out.set(id, source);
  return out;
}
