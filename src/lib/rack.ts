// Layout of the player's own rack ("tabla" in front of you): rows of fixed slots where tiles can
// sit anywhere, gaps included. Purely client-side and per device - the server only knows the hand.

import { colourOf, isJoker, numberOf } from "./remi";

export const RACK_COLS = 10;
export type Rack = (number | null)[][];
export type Slot = { row: number; col: number } | "new-row";

const emptyRow = (): (number | null)[] => Array<number | null>(RACK_COLS).fill(null);
const dropEmptyRows = (rack: Rack): Rack => rack.filter((row) => row.some((t) => t !== null));

export function sortedTiles(tiles: number[], mode: "colour" | "number"): number[] {
  const key = (t: number) =>
    isJoker(t) ? 1e6 + t : mode === "colour" ? colourOf(t) * 100 + numberOf(t) : numberOf(t) * 10 + colourOf(t);
  return [...tiles].sort((a, b) => key(a) - key(b));
}

/** Lays tiles out left to right, top to bottom. */
export function packed(tiles: number[]): Rack {
  const rack: Rack = [];
  tiles.forEach((t, i) => {
    if (i % RACK_COLS === 0) rack.push(emptyRow());
    rack[rack.length - 1][i % RACK_COLS] = t;
  });
  return rack;
}

/** Parses a stored layout, ignoring anything malformed. */
export function parseRack(raw: string | null): Rack {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((row): row is unknown[] => Array.isArray(row))
      .map((row) => Array.from({ length: RACK_COLS }, (_, c) => (Number.isInteger(row[c]) ? (row[c] as number) : null)));
  } catch {
    return [];
  }
}

/**
 * Makes a stored layout match the real hand: tiles no longer in hand leave a gap, new tiles
 * (drawn, or taken back from the table) fill the first gaps, then new rows. Empty rows vanish.
 */
export function reconcile(rack: Rack, hand: number[]): Rack {
  const inHand = new Set(hand);
  const seen = new Set<number>();
  const out: Rack = rack.map((row) =>
    row.map((t) => {
      if (t === null || !inHand.has(t) || seen.has(t)) return null;
      seen.add(t);
      return t;
    }),
  );
  const missing = sortedTiles(
    hand.filter((t) => !seen.has(t)),
    "colour",
  );
  for (const row of out) {
    for (let c = 0; c < RACK_COLS && missing.length; c++) if (row[c] === null) row[c] = missing.shift()!;
  }
  while (missing.length) {
    const row = emptyRow();
    for (let c = 0; c < RACK_COLS && missing.length; c++) row[c] = missing.shift()!;
    out.push(row);
  }
  return dropEmptyRows(out);
}

/**
 * Moves a tile: onto an empty slot it just moves, onto another tile the two swap places,
 * onto "new-row" (the + under the last row) it starts a new row in the + corner.
 */
export function moveTile(rack: Rack, tile: number, to: Slot): Rack {
  const out = rack.map((row) => [...row]);
  let from: { row: number; col: number } | null = null;
  out.forEach((row, r) => row.forEach((t, c) => t === tile && (from = { row: r, col: c })));
  if (!from) return rack;
  const { row: fr, col: fc } = from;
  if (to === "new-row") {
    out[fr][fc] = null;
    const row = emptyRow();
    row[RACK_COLS - 1] = tile;
    out.push(row);
  } else {
    if (!out[to.row] || to.col < 0 || to.col >= RACK_COLS) return rack;
    out[fr][fc] = out[to.row][to.col];
    out[to.row][to.col] = tile;
  }
  return dropEmptyRows(out);
}
