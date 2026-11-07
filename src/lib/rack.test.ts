import { describe, expect, it } from "vitest";
import { moveTile, packed, parseRack, RACK_COLS, reconcile } from "./rack";

const row = (...cells: (number | null)[]) => [...cells, ...Array(RACK_COLS - cells.length).fill(null)];

describe("rack", () => {
  it("packs tiles into rows of RACK_COLS", () => {
    const r = packed(Array.from({ length: 15 }, (_, i) => i));
    expect(r).toHaveLength(2);
    expect(r[1].filter((t) => t !== null)).toHaveLength(15 - RACK_COLS);
  });

  it("keeps gaps where the player left them", () => {
    const rack = [row(1, 2, null, null, null, 0)];
    expect(reconcile(rack, [0, 1, 2])).toEqual(rack);
  });

  it("leaves a gap for a played tile and fills the first gap with a new one", () => {
    const rack = [row(1, 2, null, 5)];
    expect(reconcile(rack, [1, 5, 9])).toEqual([row(1, 9, null, 5)]);
  });

  it("adds rows when the hand outgrows the rack and drops empty rows", () => {
    const full = [row(...Array.from({ length: RACK_COLS }, (_, i) => i))];
    const r = reconcile(full, [...Array.from({ length: RACK_COLS }, (_, i) => i), 50]);
    expect(r).toHaveLength(2);
    expect(reconcile([row(1), row(), row(2)], [1, 2])).toEqual([row(1), row(2)]);
  });

  it("moves into a gap, swaps with a tile, and opens a new row via +", () => {
    const rack = [row(1, 2, 3)];
    expect(moveTile(rack, 1, { row: 0, col: 6 })).toEqual([row(null, 2, 3, null, null, null, 1)]);
    expect(moveTile(rack, 1, { row: 0, col: 2 })).toEqual([row(3, 2, 1)]);
    const withNew = moveTile(rack, 3, "new-row");
    expect(withNew).toHaveLength(2);
    expect(withNew[1][RACK_COLS - 1]).toBe(3);
  });

  it("removes a row emptied by a move", () => {
    const rack = [row(1, 2), row(3)];
    expect(moveTile(rack, 3, { row: 0, col: 5 })).toEqual([row(1, 2, null, null, null, 3)]);
  });

  it("ignores malformed storage", () => {
    expect(parseRack("nope")).toEqual([]);
    expect(parseRack('[[1,"x",null]]')[0].slice(0, 3)).toEqual([1, null, null]);
  });
});
